<?php
declare(strict_types=1);

namespace DuskDex\Modules\Users;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Binders\BinderController;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Inventory\LocationController;
use DuskDex\Modules\Shared\Repo;

/**
 * Importa a coleção do modo convidado (navegador) para a conta, numa única transação.
 * Pré-requisitos feitos pelo cliente: cartas registradas (POST /cards) e imagens enviadas (POST /assets),
 * com o mapa id antigo → id novo em `assetMap`.
 * O histórico do navegador não é copiado: a importação vira um lote "Importação do navegador".
 * Reservas e montagens de deck não são importadas (os decks chegam como listas virtuais).
 */
final class ImportController
{
    private const KEY_RE = '/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/';

    public static function import(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('import:' . $uid, 10, 3600);
        $in = $r->json(8_000_000);
        $locations = is_array($in['locations'] ?? null) ? $in['locations'] : [];
        $copies = is_array($in['copies'] ?? null) ? $in['copies'] : [];
        $binders = is_array($in['binders'] ?? null) ? $in['binders'] : [];
        $decks = is_array($in['decks'] ?? null) ? $in['decks'] : [];
        $wishlist = is_array($in['wishlist'] ?? null) ? $in['wishlist'] : [];
        $assetMap = is_array($in['assetMap'] ?? null) ? $in['assetMap'] : [];
        if (count($copies) > 20000 || count($binders) > 200 || count($locations) > 1000 || count($decks) > 300 || count($wishlist) > 2000) {
            throw HttpException::validation('Coleção grande demais para importar de uma vez.');
        }
        $known = array_flip(array_column(Database::all('SELECT card_key FROM user_cards WHERE owner_id = ?', [$uid]), 'card_key'));
        $keyOk = fn ($k) => is_string($k) && preg_match(self::KEY_RE, $k) && isset($known[$k]);
        $assetOk = function ($old) use ($assetMap, $uid): ?string {
            $new = is_string($old) ? ($assetMap[$old] ?? null) : null;
            return is_string($new) && Database::one('SELECT 1 FROM assets WHERE public_id = ? AND owner_id = ?', [$new, $uid]) ? $new : null;
        };
        $skipped = ['copies' => 0, 'slots' => 0, 'decks' => 0, 'wishlist' => 0];

        return Database::transaction(function () use ($uid, $locations, $copies, $binders, $decks, $wishlist, $keyOk, $assetOk, &$skipped) {
            $now = Repo::now();
            $inbox = Repo::systemLocation($uid, 'inbox');
            $batchId = InventoryRepo::createBatch($uid, 'acquire', 'Importação do navegador (modo convidado)');

            // 1) locais (pais antes dos filhos); locais de sistema, de fichário e de deck são tratados à parte
            $locMap = [];
            $pending = array_values(array_filter($locations, fn ($l) => is_array($l) && empty($l['system']) && empty($l['binderId']) && empty($l['deckId']) && is_string($l['id'] ?? null)));
            foreach ($locations as $l) { if (!empty($l['system']) && empty($l['hidden']) && is_string($l['id'] ?? null)) { $locMap[$l['id']] = $inbox; } }
            $guard = 0;
            $createdLocations = 0;
            while ($pending && $guard++ < 50) {
                $next = [];
                foreach ($pending as $l) {
                    $parent = $l['parentId'] ?? null;
                    if ($parent && !isset($locMap[$parent]) && in_array($parent, array_column($pending, 'id'), true)) { $next[] = $l; continue; }
                    $name = mb_substr(trim((string) ($l['name'] ?? '')), 0, 60) ?: 'Local importado';
                    $kind = in_array($l['kind'] ?? '', LocationController::KINDS, true) ? $l['kind'] : 'custom';
                    $cap = is_numeric($l['capacity'] ?? null) && $l['capacity'] >= 1 && $l['capacity'] <= 100000 ? (int) $l['capacity'] : null;
                    $parentId = $parent && isset($locMap[$parent]) && $locMap[$parent] !== $inbox ? $locMap[$parent] : null;
                    $locMap[$l['id']] = Database::insert('INSERT INTO storage_locations (public_id, owner_id, parent_id, name, kind, description, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [Ulid::generate(), $uid, $parentId, $name, $kind, mb_substr((string) ($l['description'] ?? ''), 0, 300), $cap, $now]);
                    $createdLocations++;
                }
                $pending = $next;
            }

            // 2) fichários (bolsos de cópia ficam pendentes até as cópias existirem)
            $binderMap = []; // old id => [id, pub, location_id, pages, type]
            $locByOld = [];
            foreach ($locations as $l) { if (is_array($l) && !empty($l['binderId'])) { $locByOld[$l['binderId']] = $l; } }
            foreach ($binders as $b) {
                if (!is_array($b) || !is_string($b['id'] ?? null)) { continue; }
                $type = ($b['type'] ?? '') === 'physical' ? 'physical' : 'virtual';
                $rows = (int) ($b['layout']['rows'] ?? 3); $cols = (int) ($b['layout']['cols'] ?? 3);
                if ($rows < 1 || $rows > 6 || $cols < 1 || $cols > 6) { $rows = 3; $cols = 3; }
                $pages = [];
                foreach (array_slice(is_array($b['pages'] ?? null) ? $b['pages'] : [], 0, 200) as $p) {
                    $pr = (int) ($p['rows'] ?? $rows); $pc = (int) ($p['cols'] ?? $cols);
                    if ($pr < 1 || $pr > 6 || $pc < 1 || $pc > 6) { $pr = $rows; $pc = $cols; }
                    $np = BinderService::newPage($pr, $pc);
                    $src = array_values(is_array($p['slots'] ?? null) ? $p['slots'] : []);
                    foreach ($np['slots'] as $i => $_) {
                        $s = $src[$i] ?? null;
                        $locked = (bool) ($s['locked'] ?? false);
                        $kind = $s['kind'] ?? 'empty';
                        $slot = ['kind' => 'empty', 'locked' => $locked];
                        if ($kind === 'copy' && $type === 'physical' && is_string($s['copyId'] ?? null)) {
                            $slot = ['kind' => 'copy', 'copyId' => '__old:' . $s['copyId'], 'cardKey' => (string) ($s['cardKey'] ?? ''), 'locked' => false];
                        } elseif (in_array($kind, ['ghost', 'virtual', 'copy'], true) && $keyOk($s['cardKey'] ?? null)) {
                            $k = $kind === 'copy' ? ($type === 'virtual' ? 'virtual' : 'ghost') : ($kind === 'virtual' && $type === 'physical' ? 'ghost' : $kind);
                            if ($locked && $k === 'virtual') { $k = 'ghost'; }
                            $slot = ['kind' => $k, 'cardKey' => $s['cardKey'], 'locked' => $locked];
                        } elseif ($kind === 'image' && !$locked && ($asset = $assetOk($s['assetId'] ?? null))) {
                            $slot = ['kind' => 'image', 'assetId' => $asset, 'locked' => false];
                            if (is_array($s['panorama'] ?? null)) { $slot['panorama'] = array_intersect_key($s['panorama'], array_flip(['id', 'rows', 'cols', 'row', 'col', 'gap', 'x', 'y', 'scale'])); }
                            elseif (is_array($s['crop'] ?? null)) { $slot['crop'] = array_intersect_key($s['crop'], array_flip(['x', 'y', 'scale'])); }
                        } elseif ($kind !== 'empty') {
                            $skipped['slots']++;
                        }
                        $np['slots'][$i] = $slot;
                    }
                    $pages[] = $np;
                }
                if (!$pages) { $pages[] = BinderService::newPage($rows, $cols); }
                $app = is_array($b['appearance'] ?? null) ? $b['appearance'] : [];
                $app['coverAssetId'] = $assetOk($app['coverAssetId'] ?? null);
                if (!$keyOk($app['coverCardKey'] ?? null)) { $app['coverCardKey'] = null; }
                $vis = in_array($b['visibility'] ?? '', ['private', 'unlisted', 'public'], true) ? $b['visibility'] : 'private';
                $pub = Ulid::generate();
                $id = Database::insert('INSERT INTO binders (public_id, owner_id, name, description, type, layout_rows, layout_cols, pages, appearance, visibility, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$pub, $uid, mb_substr(trim((string) ($b['name'] ?? '')), 0, 60) ?: 'Fichário importado', mb_substr((string) ($b['description'] ?? ''), 0, 500), $type, $rows, $cols,
                        Repo::json($pages), Repo::json(BinderController::appearance($app, [], $uid)), $vis, !empty($b['favorite']) ? 1 : 0, $now, $now]);
                $locId = null;
                if ($type === 'physical') {
                    $parentOld = $locByOld[$b['id']]['parentId'] ?? null;
                    $parent = $parentOld && isset($locMap[$parentOld]) && $locMap[$parentOld] !== $inbox ? $locMap[$parentOld] : null;
                    $locId = Database::insert('INSERT INTO storage_locations (public_id, owner_id, parent_id, name, kind, description, binder_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [Ulid::generate(), $uid, $parent, mb_substr(trim((string) ($b['name'] ?? '')), 0, 60) ?: 'Fichário importado', 'binder', 'Local criado automaticamente para o fichário físico.', $id, $now]);
                    Database::exec('UPDATE binders SET location_id = ? WHERE id = ?', [$locId, $id]);
                    if (is_string($b['locationId'] ?? null)) { $locMap[$b['locationId']] = $locId; }
                }
                $binderMap[$b['id']] = ['id' => $id, 'pub' => $pub, 'loc' => $locId, 'pages' => $pages, 'type' => $type];
            }

            // 3) cópias ativas
            $copyMap = []; // old id => new pub
            $count = 0;
            foreach ($copies as $c) {
                if (!is_array($c) || ($c['status'] ?? 'active') !== 'active' || !is_string($c['id'] ?? null)) { continue; }
                if (!$keyOk($c['cardKey'] ?? null)) { $skipped['copies']++; continue; }
                $loc = isset($c['locationId']) && isset($locMap[$c['locationId']]) ? $locMap[$c['locationId']] : $inbox;
                $slotB = null; $slotP = null; $slotI = null;
                $slot = $c['slot'] ?? null;
                if (is_array($slot) && isset($binderMap[$slot['binderId'] ?? ''])) {
                    $bm = $binderMap[$slot['binderId']];
                    // localiza a página pela posição original (os ids de página são novos)
                    $srcBinder = null;
                    foreach ($binders as $ob) { if (($ob['id'] ?? null) === $slot['binderId']) { $srcBinder = $ob; break; } }
                    $pi = $srcBinder ? array_search($slot['pageId'] ?? null, array_column($srcBinder['pages'] ?? [], 'id'), true) : false;
                    $idx = (int) ($slot['index'] ?? -1);
                    if ($pi !== false && isset($bm['pages'][$pi]['slots'][$idx]) && ($bm['pages'][$pi]['slots'][$idx]['copyId'] ?? '') === '__old:' . $c['id']) {
                        $slotB = $bm['id']; $slotP = $bm['pages'][$pi]['id']; $slotI = $idx; $loc = $bm['loc'];
                    }
                }
                if ($slotB === null && in_array($loc, array_column($binderMap, 'loc'), true)) { $loc = $inbox; } // sem bolso válido: não fica "solta" no fichário
                $finish = in_array($c['finish'] ?? 'normal', ['normal', 'reverse', 'holo', 'firstEdition', 'other'], true) ? ($c['finish'] ?? 'normal') : 'other';
                $lang = preg_match('/^[a-z]{2}(-[a-z]{2})?$/', (string) ($c['lang'] ?? '')) ? $c['lang'] : 'en';
                $pub = Ulid::generate();
                $id = Database::insert('INSERT INTO card_copies (public_id, owner_id, card_key, card_id, lang, finish, card_condition, is_custom, location_id, slot_binder_id, slot_page_id, slot_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$pub, $uid, $c['cardKey'], mb_substr((string) ($c['cardId'] ?? explode(':', $c['cardKey'], 2)[1]), 0, 80), $lang, $finish, \DuskDex\Modules\Collection\CopyController::condition($c['condition'] ?? 'NM'), str_starts_with($c['cardKey'], 'custom:') ? 1 : 0, $loc, $slotB, $slotP, $slotI, $now, $now]);
                InventoryRepo::movement($batchId, $id, $c['cardKey'], ['locationId' => null, 'slot' => null], ['locationId' => $loc, 'slot' => InventoryRepo::slotJson($slotB, $slotP, $slotI)]);
                $copyMap[$c['id']] = $pub;
                $count++;
            }

            // 4) bolsos de cópia apontam para as cópias novas; os que não vieram ficam vazios
            foreach ($binderMap as $bm) {
                $changed = false;
                foreach ($bm['pages'] as &$p) {
                    foreach ($p['slots'] as &$s) {
                        if (($s['kind'] ?? '') === 'copy' && str_starts_with((string) ($s['copyId'] ?? ''), '__old:')) {
                            $old = substr($s['copyId'], 6);
                            if (isset($copyMap[$old])) { $s['copyId'] = $copyMap[$old]; }
                            else { $s = ['kind' => 'empty', 'locked' => false]; $skipped['slots']++; }
                            $changed = true;
                        }
                    }
                    unset($s);
                }
                unset($p);
                if ($changed) { Database::exec('UPDATE binders SET pages = ? WHERE id = ?', [Repo::json($bm['pages']), $bm['id']]); }
            }

            // 5) decks (listas virtuais) e wishlist
            $deckCount = 0;
            foreach ($decks as $d) {
                if (!is_array($d)) { continue; }
                $lines = [];
                foreach (is_array($d['cards'] ?? null) ? $d['cards'] : [] as $l) {
                    if ($keyOk($l['cardKey'] ?? null) && is_int($l['qty'] ?? null) && $l['qty'] >= 1 && $l['qty'] <= 60) {
                        $lines[] = ['cardKey' => $l['cardKey'], 'cardId' => mb_substr((string) ($l['cardId'] ?? explode(':', $l['cardKey'], 2)[1]), 0, 80), 'qty' => $l['qty']];
                    }
                }
                Database::insert('INSERT INTO decks (public_id, owner_id, name, description, format, cards, cover_card_key, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [Ulid::generate(), $uid, mb_substr(trim((string) ($d['name'] ?? '')), 0, 80) ?: 'Deck importado', mb_substr((string) ($d['description'] ?? ''), 0, 600),
                        in_array($d['format'] ?? '', ['standard', 'expanded', 'casual'], true) ? $d['format'] : 'standard', Repo::json(array_slice($lines, 0, 200)),
                        $keyOk($d['coverCardKey'] ?? null) ? $d['coverCardKey'] : null, in_array($d['visibility'] ?? '', ['private', 'unlisted', 'public'], true) ? $d['visibility'] : 'private', $now, $now]);
                $deckCount++;
            }
            $wishCount = 0;
            foreach ($wishlist as $w) {
                if (!is_array($w) || !$keyOk($w['cardKey'] ?? null)) { $skipped['wishlist']++; continue; }
                $cardId = mb_substr((string) ($w['cardId'] ?? explode(':', $w['cardKey'], 2)[1]), 0, 80);
                $wishCount += Database::exec('INSERT IGNORE INTO wishlist_items (public_id, owner_id, card_key, card_id, qty, priority, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [Ulid::generate(), $uid, $w['cardKey'], $cardId, max(1, min(99, (int) ($w['qty'] ?? 1))), in_array($w['priority'] ?? '', ['alta', 'normal', 'baixa'], true) ? $w['priority'] : 'normal', mb_substr((string) ($w['note'] ?? ''), 0, 140), $now, $now]);
            }
            Repo::activity($uid, 'import', "Coleção do navegador importada: $count cópia(s), " . count($binderMap) . " fichário(s), $deckCount deck(s)", 'download');
            return ['copies' => $count, 'binders' => count($binderMap), 'locations' => $createdLocations, 'decks' => $deckCount, 'wishlist' => $wishCount, 'skipped' => $skipped];
        });
    }
}
