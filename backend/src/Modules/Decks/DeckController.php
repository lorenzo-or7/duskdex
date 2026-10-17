<?php
declare(strict_types=1);

namespace DuskDex\Modules\Decks;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Shared\Repo;

/** Decklists, reservas de cópias e montagem física (o deck vira um local do inventário). */
final class DeckController
{
    private static function out(array $d): array
    {
        return ['id' => $d['public_id'], 'name' => $d['name'], 'description' => $d['description'], 'format' => $d['format'], 'cards' => Repo::decode($d['cards']), 'coverCardKey' => $d['cover_card_key'],
            'visibility' => $d['visibility'], 'status' => $d['status'], 'locationId' => $d['location_id'] !== null ? Repo::pub('storage_locations', (int) $d['location_id']) : null, 'version' => (int) $d['version'], 'createdAt' => Repo::iso($d['created_at']), 'updatedAt' => Repo::iso($d['updated_at'])];
    }

    private static function clean(int $uid, array $in): array
    {
        $v = new Validator($in);
        $name = $v->str('name', 1, 80, true, null, 'Nome');
        $desc = (string) $v->str('description', 0, 600, false);
        $format = $v->in('format', ['standard', 'expanded', 'casual'], false, 'standard');
        $vis = $v->in('visibility', ['private', 'unlisted', 'public'], false, 'private');
        $v->check();
        $cards = [];
        foreach (is_array($in['cards'] ?? null) ? $in['cards'] : [] as $l) {
            $key = $l['cardKey'] ?? '';
            if (!is_string($key) || !preg_match('/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/', $key)) { throw HttpException::validation('Carta inválida na lista.'); }
            if (!is_int($l['qty'] ?? null) || $l['qty'] < 1 || $l['qty'] > 60) { throw HttpException::validation('Quantidades devem estar entre 1 e 60.'); }
            $cards[] = ['cardKey' => $key, 'cardId' => mb_substr((string) ($l['cardId'] ?? explode(':', $key, 2)[1]), 0, 80), 'qty' => $l['qty']];
            Database::exec('INSERT IGNORE INTO user_cards (owner_id, card_key, created_at) VALUES (?, ?, ?)', [$uid, $key, Repo::now()]);
        }
        if (count($cards) > 200) { throw HttpException::validation('Lista grande demais.'); }
        $cover = is_string($in['coverCardKey'] ?? null) && preg_match('/^[a-z-]{2,6}:[A-Za-z0-9._-]{1,60}$/', $in['coverCardKey']) ? $in['coverCardKey'] : null;
        return compact('name', 'desc', 'format', 'vis', 'cards', 'cover');
    }

    public static function index(Request $r): array
    {
        return array_map([self::class, 'out'], Database::all('SELECT * FROM decks WHERE owner_id = ? ORDER BY updated_at DESC', [Security::userId()]));
    }

    public static function show(Request $r): array
    {
        $d = Database::one('SELECT * FROM decks WHERE public_id = ? AND owner_id = ?', [$r->params['id'], Security::userId()]);
        if (!$d) { throw HttpException::notFound('Deck não encontrado.'); }
        return self::out($d);
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $c = self::clean($uid, $r->json());
        $now = Repo::now();
        $id = Database::insert('INSERT INTO decks (public_id, owner_id, name, description, format, cards, cover_card_key, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [Ulid::generate(), $uid, $c['name'], $c['desc'], $c['format'], Repo::json($c['cards']), $c['cover'], $c['vis'], $now, $now]);
        Repo::activity($uid, 'deck', "Deck “{$c['name']}” criado", 'swords');
        return self::out(Database::one('SELECT * FROM decks WHERE id = ?', [$id]));
    }

    public static function update(Request $r): array
    {
        $uid = (int) Security::userId();
        $in = $r->json();
        $c = self::clean($uid, $in);
        return Database::transaction(function () use ($uid, $in, $c, $r) {
            $d = Database::one('SELECT * FROM decks WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$r->params['id'], $uid]);
            if (!$d) { throw HttpException::notFound('Deck não encontrado.'); }
            if (isset($in['version']) && $in['version'] !== null && (int) $in['version'] !== (int) $d['version']) {
                throw HttpException::conflict('O deck foi alterado em outra aba ou dispositivo.');
            }
            Database::exec('UPDATE decks SET name = ?, description = ?, format = ?, cards = ?, cover_card_key = ?, visibility = ?, version = version + 1, updated_at = ? WHERE id = ?',
                [$c['name'], $c['desc'], $c['format'], Repo::json($c['cards']), $c['cover'], $c['vis'], Repo::now(), $d['id']]);
            return self::out(Database::one('SELECT * FROM decks WHERE id = ?', [$d['id']]));
        });
    }

    private static function lockDeck(int $uid, string $pub): array
    {
        $d = Database::one('SELECT * FROM decks WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$pub, $uid]);
        if (!$d) { throw HttpException::notFound('Deck não encontrado.'); }
        return $d;
    }

    /** Reserva cópias para o deck (nada se move fisicamente). Uma cópia só pode ter uma reserva. */
    public static function reserve(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = array_values(array_unique(array_filter((array) $r->input('copyIds', []), 'is_string')));
        if (!$ids || count($ids) > 200) { throw HttpException::validation('Selecione de 1 a 200 cópias.'); }
        return Database::transaction(function () use ($uid, $ids, $r) {
            $d = self::lockDeck($uid, $r->params['id']);
            $wanted = array_column(Repo::decode($d['cards']), 'cardId');
            $in = implode(',', array_fill(0, count($ids), '?'));
            $rows = Database::all("SELECT * FROM card_copies WHERE owner_id = ? AND public_id IN ($in) ORDER BY id FOR UPDATE", array_merge([$uid], $ids));
            if (count($rows) !== count($ids)) { throw HttpException::rule('NOT_FOUND', 'Cópia não encontrada.'); }
            $n = 0;
            foreach ($rows as $c) {
                if ($c['status'] !== 'active') { throw HttpException::rule('NOT_FOUND', 'Uma das cópias não está mais na coleção.'); }
                if ($c['reserved_for'] !== null && (int) $c['reserved_for'] !== (int) $d['id']) { throw HttpException::rule('RESERVED', 'Uma das cópias já está reservada para outro deck.'); }
                if (!in_array($c['card_id'], $wanted, true)) { throw HttpException::validation('Uma das cópias não corresponde a nenhuma carta da lista.'); }
                if ($c['reserved_for'] === null) {
                    Database::exec('UPDATE card_copies SET reserved_for = ?, updated_at = ? WHERE id = ?', [$d['id'], Repo::now(), $c['id']]);
                    $n++;
                }
            }
            if ($d['status'] === 'virtual') { Database::exec("UPDATE decks SET status = 'reserved', updated_at = ? WHERE id = ?", [Repo::now(), $d['id']]); }
            Repo::activity($uid, 'deck', "$n cópia(s) reservada(s) para “{$d['name']}”", 'lock');
            return ['reserved' => $n];
        });
    }

    public static function release(Request $r): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r) {
            $d = self::lockDeck($uid, $r->params['id']);
            if ($d['status'] === 'assembled') { throw HttpException::rule('ASSEMBLED', 'Desmonte o deck antes de liberar as reservas.'); }
            Database::exec('UPDATE card_copies SET reserved_for = NULL WHERE reserved_for = ? AND owner_id = ?', [$d['id'], $uid]);
            Database::exec("UPDATE decks SET status = 'virtual', updated_at = ? WHERE id = ?", [Repo::now(), $d['id']]);
            return ['ok' => true];
        });
    }

    /** Montagem física: move as cópias reservadas para o local do deck (criado se preciso), em um único lote. */
    public static function assemble(Request $r): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r) {
            $d = self::lockDeck($uid, $r->params['id']);
            $reserved = Database::all("SELECT * FROM card_copies WHERE reserved_for = ? AND owner_id = ? AND status = 'active' ORDER BY id FOR UPDATE", [$d['id'], $uid]);
            if (!$reserved) { throw HttpException::rule('NOTHING', 'Reserve as cópias antes de montar o deck.'); }
            $locId = $d['location_id'] !== null ? (int) $d['location_id'] : null;
            if ($locId === null || !Database::one('SELECT 1 FROM storage_locations WHERE id = ?', [$locId])) {
                $parent = null;
                if ($p = $r->input('parentLocationId')) {
                    $row = Database::one('SELECT id, is_hidden FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$p, $uid]);
                    if (!$row || $row['is_hidden']) { throw HttpException::validation('Local inválido para o deck box.'); }
                    $parent = (int) $row['id'];
                }
                $locId = Database::insert('INSERT INTO storage_locations (public_id, owner_id, parent_id, name, kind, description, deck_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [Ulid::generate(), $uid, $parent, mb_substr("Deck box · {$d['name']}", 0, 60), 'deck_box', 'Local criado pela montagem física do deck.', $d['id'], Repo::now()]);
            }
            $batchId = 0;
            foreach ($reserved as $c) {
                if ($c['deck_assembled'] && (int) $c['location_id'] === $locId) { continue; }
                if (!$batchId) { $batchId = InventoryRepo::createBatch($uid, 'deck', "Montagem do deck “{$d['name']}”"); }
                $from = ['locationId' => (int) $c['location_id'], 'slot' => InventoryRepo::slotJson($c['slot_binder_id'] !== null ? (int) $c['slot_binder_id'] : null, $c['slot_page_id'], $c['slot_index'] !== null ? (int) $c['slot_index'] : null)];
                if ($c['slot_binder_id'] !== null) { BinderService::clearSlotForCopy((int) $c['slot_binder_id'], $c['slot_page_id'], (int) $c['slot_index'], $c['public_id']); }
                Database::exec('UPDATE card_copies SET location_id = ?, slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL, deck_assembled = 1, updated_at = ? WHERE id = ?', [$locId, Repo::now(), $c['id']]);
                InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'], $from, ['locationId' => $locId, 'slot' => null]);
            }
            Database::exec("UPDATE decks SET status = 'assembled', location_id = ?, updated_at = ? WHERE id = ?", [$locId, Repo::now(), $d['id']]);
            Repo::activity($uid, 'deck', "Deck “{$d['name']}” montado com " . count($reserved) . ' carta(s)', 'swords');
            return $batchId ? InventoryRepo::batchOne($uid, $batchId) : ['id' => null, 'movements' => []];
        });
    }

    public static function disassemble(Request $r): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r) {
            $d = self::lockDeck($uid, $r->params['id']);
            $destPub = $r->input('toLocationId');
            $dest = $destPub ? Database::one('SELECT * FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$destPub, $uid]) : Database::one('SELECT * FROM storage_locations WHERE owner_id = ? AND is_system = 1 AND is_hidden = 0', [$uid]);
            if (!$dest || $dest['is_hidden'] || $dest['binder_id'] !== null || $dest['deck_id'] !== null) { throw HttpException::validation('Escolha um destino válido para as cartas.'); }
            $batchId = 0;
            foreach (Database::all('SELECT * FROM card_copies WHERE reserved_for = ? AND owner_id = ? ORDER BY id FOR UPDATE', [$d['id'], $uid]) as $c) {
                if ($c['deck_assembled']) {
                    if (!$batchId) { $batchId = InventoryRepo::createBatch($uid, 'deck', "Desmontagem do deck “{$d['name']}”"); }
                    InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'], ['locationId' => (int) $c['location_id'], 'slot' => null], ['locationId' => (int) $dest['id'], 'slot' => null]);
                }
                Database::exec('UPDATE card_copies SET location_id = ?, deck_assembled = 0, reserved_for = NULL, updated_at = ? WHERE id = ?', [$c['deck_assembled'] ? $dest['id'] : $c['location_id'], Repo::now(), $c['id']]);
            }
            $loc = $d['location_id'];
            Database::exec("UPDATE decks SET status = 'virtual', location_id = NULL, updated_at = ? WHERE id = ?", [Repo::now(), $d['id']]);
            if ($loc !== null && !Database::one("SELECT 1 FROM card_copies WHERE location_id = ? LIMIT 1", [$loc])) {
                Database::exec('DELETE FROM storage_locations WHERE id = ? AND deck_id = ?', [$loc, $d['id']]);
            } elseif ($loc !== null) {
                // cópias removidas antigas ainda apontam para o local: mantém, mas solta o vínculo com o deck
                Database::exec('UPDATE storage_locations SET deck_id = NULL, name = ? WHERE id = ?', [mb_substr("Deck box (desmontado) · {$d['name']}", 0, 60), $loc]);
            }
            Repo::activity($uid, 'deck', "Deck “{$d['name']}” desmontado", 'swords');
            return $batchId ? InventoryRepo::batchOne($uid, $batchId) : ['id' => null, 'movements' => []];
        });
    }

    public static function destroy(Request $r): array
    {
        $uid = (int) Security::userId();
        $d = Database::one('SELECT * FROM decks WHERE public_id = ? AND owner_id = ?', [$r->params['id'], $uid]);
        if (!$d) { throw HttpException::notFound('Deck não encontrado.'); }
        if ($d['status'] === 'assembled') { throw HttpException::rule('ASSEMBLED', 'Desmonte o deck físico antes de excluí-lo.'); }
        Database::exec('UPDATE card_copies SET reserved_for = NULL WHERE reserved_for = ?', [$d['id']]);
        Database::exec('DELETE FROM decks WHERE id = ?', [$d['id']]);
        Repo::activity($uid, 'deck', "Deck “{$d['name']}” excluído", 'trash');
        return ['ok' => true];
    }
}
