<?php
declare(strict_types=1);

namespace DuskDex\Modules\Binders;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Shared\Repo;

final class BinderController
{
    private const STYLES = ['classico', 'couro', 'holo', 'noturno'];
    private const SLOT_STYLES = ['rounded', 'square', 'glow'];

    public static function index(Request $r): array
    {
        $rows = Database::all('SELECT * FROM binders WHERE owner_id = ? ORDER BY updated_at DESC', [Security::userId()]);
        return array_map([BinderService::class, 'out'], $rows);
    }

    public static function show(Request $r): array
    {
        $b = Database::one('SELECT * FROM binders WHERE public_id = ? AND owner_id = ?', [$r->params['id'], Security::userId()]);
        if (!$b) { throw HttpException::notFound('Fichário não encontrado.'); }
        return BinderService::out($b);
    }

    public static function appearance(array $a, array $cur = [], int $uid = 0): array
    {
        $cover = array_key_exists('coverAssetId', $a) ? $a['coverAssetId'] : ($cur['coverAssetId'] ?? null);
        if ($cover !== null && $uid) { \DuskDex\Modules\Assets\AssetController::ownedId($uid, $cover); }
        $hex = fn ($v, $d) => is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? $v : $d;
        $key = $a['coverCardKey'] ?? ($cur['coverCardKey'] ?? null);
        return [
            'color' => $hex($a['color'] ?? null, $cur['color'] ?? '#4b2f5e'),
            'sheetColor' => $hex($a['sheetColor'] ?? null, $cur['sheetColor'] ?? '#1a1420'),
            'style' => in_array($a['style'] ?? null, self::STYLES, true) ? $a['style'] : ($cur['style'] ?? 'classico'),
            'slotStyle' => in_array($a['slotStyle'] ?? null, self::SLOT_STYLES, true) ? $a['slotStyle'] : ($cur['slotStyle'] ?? 'rounded'),
            'coverCardKey' => is_string($key) && preg_match('/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/', $key) ? $key : null,
            'coverAssetId' => is_string($cover) && $cover !== '' ? $cover : null,
            'firstPageRight' => array_key_exists('firstPageRight', $a) ? (bool) $a['firstPageRight'] : (bool) ($cur['firstPageRight'] ?? false),
        ];
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $in = $r->json();
        $v = new Validator($in);
        $name = $v->str('name', 1, 60, true, null, 'Nome');
        $type = $v->in('type', ['physical', 'virtual']);
        $rows = $v->int('rows', 1, 6); $cols = $v->int('cols', 1, 6);
        $pagesN = $v->int('pages', 1, 200, false, 10);
        $vis = $v->in('visibility', ['private', 'unlisted', 'public'], false, 'private');
        $desc = (string) $v->str('description', 0, 500, false);
        $v->check();
        return Database::transaction(function () use ($uid, $in, $name, $type, $rows, $cols, $pagesN, $vis, $desc) {
            $now = Repo::now();
            $pages = [];
            for ($i = 0; $i < $pagesN; $i++) { $pages[] = BinderService::newPage($rows, $cols); }
            $pub = Ulid::generate();
            $id = Database::insert('INSERT INTO binders (public_id, owner_id, name, description, type, layout_rows, layout_cols, pages, appearance, visibility, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$pub, $uid, $name, $desc, $type, $rows, $cols, Repo::json($pages), Repo::json(self::appearance($in, [], $uid)), $vis, !empty($in['favorite']) ? 1 : 0, $now, $now]);
            if ($type === 'physical') {
                $parent = null;
                if (!empty($in['parentLocationId'])) {
                    $p = Database::one('SELECT id, is_hidden FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$in['parentLocationId'], $uid]);
                    if (!$p || $p['is_hidden']) { throw HttpException::validation('Local de armazenamento inválido.'); }
                    $parent = (int) $p['id'];
                }
                $locId = Database::insert('INSERT INTO storage_locations (public_id, owner_id, parent_id, name, kind, description, binder_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [Ulid::generate(), $uid, $parent, $name, 'binder', 'Local criado automaticamente para o fichário físico.', $id, $now]);
                Database::exec('UPDATE binders SET location_id = ? WHERE id = ?', [$locId, $id]);
            }
            Repo::activity($uid, 'binder', 'Fichário ' . ($type === 'physical' ? 'físico' : 'virtual') . " “{$name}” criado", 'book');
            return BinderService::out(Database::one('SELECT * FROM binders WHERE id = ?', [$id]));
        });
    }

    public static function update(Request $r): array
    {
        $uid = (int) Security::userId();
        $in = $r->json();
        return Database::transaction(function () use ($uid, $in, $r) {
            $b = Database::one('SELECT * FROM binders WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$r->params['id'], $uid]);
            if (!$b) { throw HttpException::notFound('Fichário não encontrado.'); }
            if (isset($in['expectedVersion']) && $in['expectedVersion'] !== null && (int) $in['expectedVersion'] !== (int) $b['version']) {
                throw HttpException::conflict('O fichário foi alterado em outra aba ou dispositivo.');
            }
            $v = new Validator($in);
            $name = array_key_exists('name', $in) ? $v->str('name', 1, 60, true, null, 'Nome') : $b['name'];
            $desc = array_key_exists('description', $in) ? (string) $v->str('description', 0, 500, false) : $b['description'];
            $vis = array_key_exists('visibility', $in) ? $v->in('visibility', ['private', 'unlisted', 'public']) : $b['visibility'];
            $v->check();
            $fav = array_key_exists('favorite', $in) ? (!empty($in['favorite']) ? 1 : 0) : (int) $b['favorite'];
            $app = isset($in['appearance']) && is_array($in['appearance']) ? self::appearance($in['appearance'], Repo::decode($b['appearance']), $uid) : Repo::decode($b['appearance']);
            Database::exec('UPDATE binders SET name = ?, description = ?, visibility = ?, favorite = ?, appearance = ?, version = version + 1, updated_at = ? WHERE id = ?',
                [$name, $desc, $vis, $fav, Repo::json($app), Repo::now(), $b['id']]);
            if ($b['location_id'] !== null && $name !== $b['name']) {
                Database::exec('UPDATE storage_locations SET name = ? WHERE id = ?', [$name, $b['location_id']]);
            }
            return BinderService::out(Database::one('SELECT * FROM binders WHERE id = ?', [$b['id']]));
        });
    }

    public static function destroy(Request $r): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r) {
            $b = Database::one('SELECT * FROM binders WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$r->params['id'], $uid]);
            if (!$b) { throw HttpException::notFound('Fichário não encontrado.'); }
            $inside = Database::all("SELECT * FROM card_copies WHERE slot_binder_id = ? AND status = 'active' FOR UPDATE", [$b['id']]);
            if ($inside) {
                $destPub = (string) ($r->query['moveCopiesTo'] ?? '');
                $dest = $destPub !== '' ? Database::one('SELECT id, is_hidden, binder_id FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$destPub, $uid]) : ['id' => Repo::systemLocation($uid, 'inbox'), 'is_hidden' => 0, 'binder_id' => null];
                if (!$dest || $dest['is_hidden'] || (int) ($dest['binder_id'] ?? 0) === (int) $b['id']) { throw HttpException::validation('Escolha para onde as cartas do fichário vão.'); }
                $batchId = InventoryRepo::createBatch($uid, 'move', "Esvaziar fichário “{$b['name']}”");
                foreach ($inside as $c) {
                    InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'], ['locationId' => (int) $c['location_id'], 'slot' => InventoryRepo::slotJson((int) $c['slot_binder_id'], $c['slot_page_id'], (int) $c['slot_index'])], ['locationId' => (int) $dest['id'], 'slot' => null]);
                    Database::exec('UPDATE card_copies SET location_id = ?, slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL, updated_at = ? WHERE id = ?', [$dest['id'], Repo::now(), $c['id']]);
                }
            }
            // cópias removidas que ainda referenciam o local/fichário
            Database::exec('UPDATE card_copies SET slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL WHERE slot_binder_id = ?', [$b['id']]);
            Database::exec('UPDATE binders SET location_id = NULL WHERE id = ?', [$b['id']]);
            if ($b['location_id'] !== null) {
                Database::exec('DELETE FROM storage_locations WHERE id = ? AND binder_id = ?', [$b['location_id'], $b['id']]);
            }
            Database::exec('DELETE FROM binders WHERE id = ?', [$b['id']]);
            Repo::activity($uid, 'binder', "Fichário “{$b['name']}” excluído", 'trash');
            return ['ok' => true];
        });
    }

    /** Copia a estrutura como novo fichário VIRTUAL (cópias físicas viram referências; nada é duplicado no inventário). */
    public static function duplicate(Request $r): array
    {
        $uid = (int) Security::userId();
        $b = Database::one('SELECT * FROM binders WHERE public_id = ? AND owner_id = ?', [$r->params['id'], $uid]);
        if (!$b) { throw HttpException::notFound('Fichário não encontrado.'); }
        $v = new Validator($r->json());
        $name = $v->str('name', 1, 60, false, null, 'Nome') ?? mb_substr($b['name'] . ' (cópia virtual)', 0, 60);
        $v->check();
        $pages = array_map(function ($p) {
            $np = BinderService::newPage((int) $p['rows'], (int) $p['cols']);
            $np['slots'] = array_map(fn ($sl) => ($sl['kind'] ?? '') === 'copy'
                ? ['kind' => 'virtual', 'cardKey' => $sl['cardKey'], 'locked' => (bool) ($sl['locked'] ?? false)]
                : $sl, $p['slots']);
            return $np;
        }, Repo::decode($b['pages']));
        $app = Repo::decode($b['appearance']);
        $now = Repo::now();
        $id = Database::insert('INSERT INTO binders (public_id, owner_id, name, description, type, layout_rows, layout_cols, pages, appearance, visibility, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
            [Ulid::generate(), $uid, $name, $b['description'], 'virtual', $b['layout_rows'], $b['layout_cols'], Repo::json($pages), Repo::json($app), 'private', $now, $now]);
        Repo::activity($uid, 'binder', "Fichário virtual “{$name}” criado a partir de “{$b['name']}”", 'book');
        return BinderService::out(Database::one('SELECT * FROM binders WHERE id = ?', [$id]));
    }

    public static function ops(Request $r): array
    {
        $ops = $r->input('ops', []);
        $ver = $r->input('expectedVersion');
        return BinderService::ops((int) Security::userId(), $r->params['id'], is_array($ops) ? $ops : [], is_int($ver) ? $ver : null, mb_substr((string) ($r->input('label') ?: 'Edição de fichário'), 0, 80));
    }
}
