<?php
declare(strict_types=1);

namespace DuskDex\Modules\Collection;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Shared\Repo;

/** Cópias físicas individuais: cadastro (gera N linhas), listagem e remoção com histórico. */
final class CopyController
{
    private const FINISHES = ['normal', 'reverse', 'holo', 'firstEdition', 'other'];
    /** Estados de conservação: Mint, Near Mint, Slightly Played, Moderately Played, Heavily Played, Damaged, Hard Damaged. */
    public const CONDITIONS = ['M', 'NM', 'SP', 'MP', 'HP', 'D', 'HD'];

    public static function condition(mixed $v): string
    {
        $v = strtoupper((string) $v);
        return in_array($v, self::CONDITIONS, true) ? $v : 'NM';
    }

    public static function index(Request $r): array
    {
        $uid = (int) Security::userId();
        $rows = Database::all('SELECT * FROM card_copies WHERE owner_id = ? ORDER BY id', [$uid]);
        $bp = [];
        foreach (Database::all('SELECT id, public_id FROM binders WHERE owner_id = ?', [$uid]) as $b) { $bp[(int) $b['id']] = $b['public_id']; }
        return array_map(fn ($c) => InventoryRepo::copyOut($c, $bp), $rows);
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $items = $r->input('items', []);
        if (!is_array($items) || !$items || count($items) > 100) {
            throw HttpException::validation('Informe de 1 a 100 cartas.');
        }
        $clean = [];
        foreach ($items as $i) {
            $qty = $i['qty'] ?? null;
            $key = (string) ($i['cardKey'] ?? '');
            if (!is_int($qty) || $qty < 1 || $qty > 99) { throw HttpException::validation('Quantidade deve ser um inteiro entre 1 e 99 por carta.'); }
            if (!preg_match('/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/', $key)) { throw HttpException::validation('Carta inválida.'); }
            if (!Database::one('SELECT 1 FROM user_cards WHERE owner_id = ? AND card_key = ?', [$uid, $key])) { throw HttpException::validation('Carta desconhecida: registre o snapshot (POST /cards) antes de cadastrar cópias.'); }
            $finish = in_array($i['finish'] ?? 'normal', self::FINISHES, true) ? ($i['finish'] ?? 'normal') : 'other';
            $lang = preg_match('/^[a-z]{2}(-[a-z]{2})?$/', (string) ($i['lang'] ?? '')) ? $i['lang'] : 'en';
            $clean[] = ['key' => $key, 'cardId' => mb_substr((string) ($i['cardId'] ?? explode(':', $key, 2)[1]), 0, 80), 'lang' => $lang, 'finish' => $finish, 'condition' => self::condition($i['condition'] ?? 'NM'), 'qty' => $qty, 'custom' => str_starts_with($key, 'custom:')];
        }
        return Database::transaction(function () use ($uid, $clean, $r) {
            $locPub = $r->input('locationId');
            if ($locPub) {
                $loc = Database::one('SELECT id, name, is_hidden, binder_id, deck_id FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$locPub, $uid]);
                if (!$loc || $loc['is_hidden'] || $loc['binder_id'] !== null) { throw HttpException::validation('Local de destino inválido.'); }
                if ($loc['deck_id'] !== null) { throw HttpException::validation('Para colocar cartas em um deck montado use o fluxo de montagem do deck.'); }
            } else {
                $loc = Database::one('SELECT id, name FROM storage_locations WHERE owner_id = ? AND is_system = 1 AND is_hidden = 0', [$uid]);
            }
            $label = mb_substr((string) ($r->input('label') ?: 'Cadastro de cartas'), 0, 160);
            $batchId = InventoryRepo::createBatch($uid, 'acquire', $label);
            $now = Repo::now();
            $created = [];
            foreach ($clean as $c) {
                for ($n = 0; $n < $c['qty']; $n++) {
                    $pub = Ulid::generate();
                    $id = Database::insert('INSERT INTO card_copies (public_id, owner_id, card_key, card_id, lang, finish, card_condition, is_custom, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$pub, $uid, $c['key'], $c['cardId'], $c['lang'], $c['finish'], $c['condition'], $c['custom'] ? 1 : 0, $loc['id'], $now, $now]);
                    InventoryRepo::movement($batchId, $id, $c['key'], ['locationId' => null, 'slot' => null], ['locationId' => (int) $loc['id'], 'slot' => null]);
                    $created[] = $id;
                }
            }
            Repo::activity($uid, 'acquire', count($created) . " cópia(s) cadastrada(s) em “{$loc['name']}”", 'plus');
            $in = implode(',', array_fill(0, count($created), '?'));
            $rows = Database::all("SELECT * FROM card_copies WHERE id IN ($in)", $created);
            return ['batch' => ['id' => Repo::pub('inventory_batches', $batchId)], 'copies' => array_map(fn ($c) => InventoryRepo::copyOut($c), $rows)];
        });
    }

    /** Marca/desmarca cópias como disponíveis para troca (visíveis a outros colecionadores, sem a localização). */
    public static function tradeFlag(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = array_values(array_filter((array) $r->input('copyIds', []), 'is_string'));
        if (!$ids || count($ids) > 1000) { throw HttpException::validation('Selecione de 1 a 1000 cópias.'); }
        $on = (bool) $r->input('forTrade', true);
        $in = implode(',', array_fill(0, count($ids), '?'));
        if ($on && Database::one("SELECT 1 FROM card_copies WHERE owner_id = ? AND public_id IN ($in) AND is_custom = 1 LIMIT 1", array_merge([$uid], $ids))) {
            throw HttpException::validation('Cartas personalizadas não podem ser oferecidas em trocas.');
        }
        $n = Database::exec("UPDATE card_copies SET for_trade = ?, updated_at = ? WHERE owner_id = ? AND status = 'active' AND public_id IN ($in)", array_merge([$on ? 1 : 0, Repo::now(), $uid], $ids));
        return ['updated' => $n];
    }

    /** Altera o estado de conservação de uma ou mais cópias. */
    public static function setCondition(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = array_values(array_filter((array) $r->input('copyIds', []), 'is_string'));
        if (!$ids || count($ids) > 1000) { throw HttpException::validation('Selecione de 1 a 1000 cópias.'); }
        $cond = strtoupper((string) $r->input('condition', ''));
        if (!in_array($cond, self::CONDITIONS, true)) { throw HttpException::validation('Estado de conservação inválido.'); }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $n = Database::exec("UPDATE card_copies SET card_condition = ?, updated_at = ? WHERE owner_id = ? AND status = 'active' AND public_id IN ($in)", array_merge([$cond, Repo::now(), $uid], $ids));
        return ['updated' => $n];
    }

    public static function remove(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = $r->input('copyIds', []);
        if (!is_array($ids) || !$ids || count($ids) > 500) { throw HttpException::validation('Informe as cópias a remover.'); }
        return Database::transaction(function () use ($uid, $ids, $r) {
            $removedLoc = Repo::systemLocation($uid, 'removed');
            $in = implode(',', array_fill(0, count($ids), '?'));
            $rows = Database::all("SELECT * FROM card_copies WHERE owner_id = ? AND public_id IN ($in) AND status = 'active' ORDER BY id FOR UPDATE", array_merge([$uid], array_values($ids)));
            if (!$rows) { return null; }
            foreach ($rows as $c) {
                if ($c['deck_assembled']) { throw HttpException::rule('IN_DECK', 'Uma das cópias está montada em um deck físico.'); }
            }
            $batchId = InventoryRepo::createBatch($uid, 'remove', mb_substr((string) ($r->input('reason') ?: 'Removida da coleção'), 0, 160));
            foreach ($rows as $c) {
                if ($c['slot_binder_id'] !== null) {
                    BinderService::clearSlotForCopy((int) $c['slot_binder_id'], $c['slot_page_id'], (int) $c['slot_index'], $c['public_id']);
                }
                InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'],
                    ['locationId' => (int) $c['location_id'], 'slot' => InventoryRepo::slotJson($c['slot_binder_id'] !== null ? (int) $c['slot_binder_id'] : null, $c['slot_page_id'], $c['slot_index'] !== null ? (int) $c['slot_index'] : null)],
                    ['locationId' => $removedLoc, 'slot' => null]);
                Database::exec("UPDATE card_copies SET status = 'removed', location_id = ?, slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL, reserved_for = NULL, for_trade = 0, updated_at = ? WHERE id = ?", [$removedLoc, Repo::now(), $c['id']]);
            }
            Repo::activity($uid, 'remove', count($rows) . ' cópia(s) removida(s) da coleção', 'trash');
            return ['id' => Repo::pub('inventory_batches', $batchId), 'movements' => count($rows)];
        });
    }
}
