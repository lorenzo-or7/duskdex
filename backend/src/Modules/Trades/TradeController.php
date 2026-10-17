<?php
declare(strict_types=1);

namespace DuskDex\Modules\Trades;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Community\Social;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Shared\Repo;

/**
 * Trocas entre colecionadores (sem pagamento, sem envio — o app só registra o combinado).
 * Proposta: cartas que eu ofereço (minhas) + cartas que eu quero (marcadas "para troca" pelo outro).
 * Aceite: transação única; cada cópia é conferida e travada. Quem entrega tem a cópia retirada da coleção
 * (movimento para "Fora da coleção"); quem recebe ganha uma cópia nova em "Sem local definido".
 * Cada lado vê a troca no próprio histórico de inventário. Nada é publicado.
 */
final class TradeController
{
    private const MAX_ITEMS = 40;

    public static function tradable(Request $r): array
    {
        $viewer = (int) Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        $uid = (int) $u['id'];
        if ($uid !== $viewer) {
            if (Social::blockedBetween($viewer, $uid)) { throw HttpException::notFound('Colecionador não encontrado.'); }
            $priv = Repo::decode($u['privacy'] ?? null, []);
            if (($priv['showTrades'] ?? true) === false) { return ['items' => [], 'cards' => [], 'hidden' => true]; }
        }
        $rows = Database::all("SELECT public_id, card_key, card_id, lang, finish, card_condition FROM card_copies WHERE owner_id = ? AND status = 'active' AND for_trade = 1 AND deck_assembled = 0 AND is_custom = 0 ORDER BY card_id, id LIMIT 2000", [$uid]);
        $wish = array_flip(array_column(Database::all('SELECT card_id FROM wishlist_items WHERE owner_id = ?', [$viewer]), 'card_id'));
        $items = array_map(fn ($c) => ['copyId' => $c['public_id'], 'cardKey' => $c['card_key'], 'cardId' => $c['card_id'], 'lang' => $c['lang'], 'finish' => $c['finish'], 'condition' => $c['card_condition'], 'inMyWishlist' => isset($wish[$c['card_id']])], $rows);
        return ['items' => $items, 'cards' => array_values(Social::snapshots(array_column($rows, 'card_key'), $uid)), 'hidden' => false];
    }

    private static function out(array $t, int $viewer): array
    {
        $items = Database::all('SELECT ti.*, c.public_id AS copy_pub, c.owner_id AS cur_owner, c.status AS cur_status, c.deck_assembled, c.for_trade, c.card_condition AS cur_condition FROM trade_items ti LEFT JOIN card_copies c ON c.id = ti.copy_id WHERE ti.trade_id = ? ORDER BY ti.id', [$t['id']]);
        $users = Social::briefs([(int) $t['proposer_id'], (int) $t['recipient_id']]);
        $snaps = Social::snapshots(array_column($items, 'card_key'));
        $pending = $t['status'] === 'pending';
        $map = function ($it) use ($snaps, $pending, $t) {
            $ok = !$pending || ($it['cur_owner'] !== null && (int) $it['cur_owner'] === (int) $it['from_user_id'] && $it['cur_status'] === 'active' && !$it['deck_assembled']
                && ((int) $it['from_user_id'] === (int) $t['proposer_id'] || (bool) $it['for_trade']));
            // o estado anunciado na proposta precisa ser o estado atual da carta
            $changed = $pending && $it['cur_condition'] !== null && $it['cur_condition'] !== ($it['card_condition'] ?? 'NM');
            return ['copyId' => $it['copy_pub'], 'cardKey' => $it['card_key'], 'cardId' => $it['card_id'], 'lang' => $it['lang'], 'finish' => $it['finish'], 'condition' => $it['card_condition'] ?? 'NM',
                'card' => $snaps[$it['card_key']] ?? null, 'available' => $ok && !$changed, 'conditionNow' => $changed ? $it['cur_condition'] : null];
        };
        $give = array_values(array_map($map, array_filter($items, fn ($i) => (int) $i['from_user_id'] === (int) $t['proposer_id'])));
        $want = array_values(array_map($map, array_filter($items, fn ($i) => (int) $i['from_user_id'] === (int) $t['recipient_id'])));
        return [
            'id' => $t['public_id'], 'status' => $t['status'], 'message' => $t['message'], 'response' => $t['response'],
            'proposer' => $users[(int) $t['proposer_id']] ?? null, 'recipient' => $users[(int) $t['recipient_id']] ?? null,
            'direction' => (int) $t['proposer_id'] === $viewer ? 'outgoing' : 'incoming',
            'offered' => $give, 'requested' => $want,
            'available' => !in_array(false, array_column(array_merge($give, $want), 'available'), true),
            'createdAt' => Repo::iso($t['created_at']), 'respondedAt' => Repo::iso($t['responded_at']),
        ];
    }

    public static function index(Request $r): array
    {
        $uid = (int) Security::userId();
        $box = $r->query['box'] ?? 'open';
        $sql = match ($box) {
            'incoming' => "recipient_id = ? AND status = 'pending'",
            'outgoing' => "proposer_id = ? AND status = 'pending'",
            'history' => "(proposer_id = ? OR recipient_id = ?) AND status <> 'pending'",
            default => "(proposer_id = ? OR recipient_id = ?) AND status = 'pending'",
        };
        $params = substr_count($sql, '?') === 2 ? [$uid, $uid] : [$uid];
        $rows = Database::all("SELECT * FROM trades WHERE $sql ORDER BY id DESC LIMIT 100", $params);
        return array_map(fn ($t) => self::out($t, $uid), $rows);
    }

    public static function show(Request $r): array
    {
        $uid = (int) Security::userId();
        return self::out(self::find($uid, (string) $r->params['id']), $uid);
    }

    private static function find(int $uid, string $pub, bool $lock = false): array
    {
        $t = Database::one('SELECT * FROM trades WHERE public_id = ? AND (proposer_id = ? OR recipient_id = ?)' . ($lock ? ' FOR UPDATE' : ''), [$pub, $uid, $uid]);
        if (!$t) { throw HttpException::notFound('Troca não encontrada.'); }
        return $t;
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('trade:' . $uid, Env::int('RATE_TRADES_PER_DAY', 30), 86400);
        $to = Social::userByUsername((string) $r->input('to', ''));
        $rid = (int) $to['id'];
        if ($rid === $uid) { throw HttpException::validation('Escolha outro colecionador.'); }
        if (Social::blockedBetween($uid, $rid)) { throw new HttpException(403, 'BLOCKED', 'Não é possível propor trocas a este colecionador.'); }
        $give = array_values(array_unique(array_filter((array) $r->input('give', []), 'is_string')));
        $want = array_values(array_unique(array_filter((array) $r->input('want', []), 'is_string')));
        if (!$give && !$want) { throw HttpException::validation('Escolha ao menos uma carta para oferecer ou pedir.'); }
        if (count($give) + count($want) > self::MAX_ITEMS) { throw HttpException::validation('No máximo ' . self::MAX_ITEMS . ' cartas por troca.'); }
        $message = is_string($r->input('message')) ? mb_substr(trim((string) $r->input('message')), 0, 500) : '';
        $load = function (array $pubs, int $owner, bool $mustBeForTrade): array {
            if (!$pubs) { return []; }
            $in = implode(',', array_fill(0, count($pubs), '?'));
            $rows = Database::all("SELECT * FROM card_copies WHERE owner_id = ? AND public_id IN ($in)", array_merge([$owner], $pubs));
            if (count($rows) !== count($pubs)) { throw HttpException::validation('Uma das cartas escolhidas não está disponível.'); }
            foreach ($rows as $c) {
                if ($c['status'] !== 'active' || $c['deck_assembled'] || $c['is_custom'] || ($mustBeForTrade && !$c['for_trade'])) {
                    throw HttpException::validation('Uma das cartas escolhidas não está disponível para troca.');
                }
            }
            return $rows;
        };
        $mine = $load($give, $uid, false);
        $theirs = $load($want, $rid, true);
        return Database::transaction(function () use ($uid, $rid, $mine, $theirs, $message, $to) {
            $now = Repo::now();
            $pub = Ulid::generate();
            $tid = Database::insert('INSERT INTO trades (public_id, proposer_id, recipient_id, status, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$pub, $uid, $rid, 'pending', $message, $now, $now]);
            foreach ([[$mine, $uid], [$theirs, $rid]] as [$rows, $from]) {
                foreach ($rows as $c) {
                    Database::exec('INSERT INTO trade_items (trade_id, copy_id, from_user_id, card_key, card_id, lang, finish, card_condition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$tid, $c['id'], $from, $c['card_key'], $c['card_id'], $c['lang'], $c['finish'], $c['card_condition'] ?? 'NM']);
                }
            }
            $me = Social::briefs([$uid])[$uid];
            Social::notify($rid, $uid, 'trade', "@{$me['username']} propôs uma troca: " . count($mine) . ' carta(s) por ' . count($theirs), 'trade', $pub);
            Repo::activity($uid, 'trade', "Troca proposta a @{$to['username']}", 'repeat');
            return self::out(Database::one('SELECT * FROM trades WHERE id = ?', [$tid]), $uid);
        });
    }

    public static function accept(Request $r): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r) {
            $t = self::find($uid, (string) $r->params['id'], true);
            if ((int) $t['recipient_id'] !== $uid) { throw new HttpException(403, 'FORBIDDEN', 'Só quem recebeu a proposta pode aceitá-la.'); }
            if ($t['status'] !== 'pending') { throw HttpException::conflict('Esta troca não está mais pendente.'); }
            if (Social::blockedBetween((int) $t['proposer_id'], $uid)) { throw HttpException::conflict('Troca indisponível.'); }
            $items = Database::all('SELECT * FROM trade_items WHERE trade_id = ? ORDER BY copy_id', [$t['id']]);
            $ids = array_column($items, 'copy_id');
            $in = implode(',', array_fill(0, count($ids), '?'));
            $copies = [];
            foreach (Database::all("SELECT * FROM card_copies WHERE id IN ($in) ORDER BY id FOR UPDATE", $ids) as $c) { $copies[(int) $c['id']] = $c; }
            foreach ($items as $it) {
                $c = $copies[(int) $it['copy_id']] ?? null;
                $fromProposer = (int) $it['from_user_id'] === (int) $t['proposer_id'];
                if (!$c || (int) $c['owner_id'] !== (int) $it['from_user_id'] || $c['status'] !== 'active' || $c['deck_assembled']) {
                    throw HttpException::conflict('Uma das cartas da troca não está mais disponível (' . ($fromProposer ? 'de quem propôs' : 'sua') . '). Peça uma nova proposta.');
                }
                if (($c['card_condition'] ?? 'NM') !== ($it['card_condition'] ?? 'NM')) {
                    throw HttpException::conflict('O estado de conservação de uma das cartas mudou desde a proposta (' . ($it['card_condition'] ?? 'NM') . ' → ' . $c['card_condition'] . '). Peça uma nova proposta.');
                }
            }
            $names = Social::briefs([(int) $t['proposer_id'], $uid]);
            $batches = [];
            $batchFor = function (int $owner) use (&$batches, $t, $names): int {
                if (!isset($batches[$owner])) {
                    $other = $owner === (int) $t['proposer_id'] ? $names[(int) $t['recipient_id']] : $names[(int) $t['proposer_id']];
                    $batches[$owner] = InventoryRepo::createBatch($owner, 'trade', "Troca com @{$other['username']}");
                }
                return $batches[$owner];
            };
            $now = Repo::now();
            foreach ($items as $it) {
                $c = $copies[(int) $it['copy_id']];
                $giver = (int) $it['from_user_id'];
                $receiver = $giver === (int) $t['proposer_id'] ? (int) $t['recipient_id'] : (int) $t['proposer_id'];
                // quem entrega: a cópia sai da coleção (histórico preservado)
                $fromSlot = InventoryRepo::slotJson($c['slot_binder_id'] !== null ? (int) $c['slot_binder_id'] : null, $c['slot_page_id'], $c['slot_index'] !== null ? (int) $c['slot_index'] : null);
                if ($c['slot_binder_id'] !== null) { BinderService::clearSlotForCopy((int) $c['slot_binder_id'], $c['slot_page_id'], (int) $c['slot_index'], $c['public_id']); }
                $removed = Repo::systemLocation($giver, 'removed');
                Database::exec("UPDATE card_copies SET status = 'removed', location_id = ?, slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL, reserved_for = NULL, for_trade = 0, updated_at = ? WHERE id = ?", [$removed, $now, $c['id']]);
                InventoryRepo::movement($batchFor($giver), (int) $c['id'], $c['card_key'], ['locationId' => (int) $c['location_id'], 'slot' => $fromSlot], ['locationId' => $removed, 'slot' => null]);
                // quem recebe: cópia nova em "Sem local definido"
                $inbox = Repo::systemLocation($receiver, 'inbox');
                $newPub = Ulid::generate();
                $newId = Database::insert('INSERT INTO card_copies (public_id, owner_id, card_key, card_id, lang, finish, card_condition, is_custom, location_id, origin_trade_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
                    [$newPub, $receiver, $c['card_key'], $c['card_id'], $c['lang'], $c['finish'], $c['card_condition'] ?? 'NM', $inbox, $t['id'], $now, $now]);
                InventoryRepo::movement($batchFor($receiver), $newId, $c['card_key'], ['locationId' => null, 'slot' => null], ['locationId' => $inbox, 'slot' => null]);
                Database::exec('UPDATE trade_items SET new_copy_id = ? WHERE id = ?', [$newId, $it['id']]);
                Database::exec('INSERT IGNORE INTO user_cards (owner_id, card_key, created_at) VALUES (?, ?, ?)', [$receiver, $c['card_key'], $now]);
                if (!Database::one('SELECT 1 FROM card_snapshots WHERE owner_id = 0 AND card_key = ?', [$c['card_key']])) {
                    // carta sem snapshot global verificado: copia o snapshot privado de quem entregou
                    Database::exec('INSERT IGNORE INTO card_snapshots (owner_id, card_key, card_id, lang, name, data, verified, updated_at) SELECT ?, card_key, card_id, lang, name, data, 0, ? FROM card_snapshots WHERE owner_id = ? AND card_key = ?', [$receiver, $now, $giver, $c['card_key']]);
                }
            }
            $msg = is_string($r->input('message')) ? mb_substr(trim((string) $r->input('message')), 0, 500) : '';
            Database::exec("UPDATE trades SET status = 'accepted', response = ?, responded_at = ?, updated_at = ? WHERE id = ?", [$msg, $now, $now, $t['id']]);
            $me = $names[$uid];
            $prop = $names[(int) $t['proposer_id']];
            Social::notify((int) $t['proposer_id'], $uid, 'trade', "@{$me['username']} aceitou sua troca", 'trade', $t['public_id']);
            Repo::activity($uid, 'trade', "Troca com @{$prop['username']} concluída", 'repeat');
            Repo::activity((int) $t['proposer_id'], 'trade', "Troca com @{$me['username']} concluída", 'repeat');
            return self::out(Database::one('SELECT * FROM trades WHERE id = ?', [$t['id']]), $uid);
        });
    }

    public static function decline(Request $r): array
    {
        return self::close($r, 'declined');
    }

    public static function cancel(Request $r): array
    {
        return self::close($r, 'cancelled');
    }

    private static function close(Request $r, string $status): array
    {
        $uid = (int) Security::userId();
        return Database::transaction(function () use ($uid, $r, $status) {
            $t = self::find($uid, (string) $r->params['id'], true);
            if ($t['status'] !== 'pending') { throw HttpException::conflict('Esta troca não está mais pendente.'); }
            $mustBe = $status === 'declined' ? (int) $t['recipient_id'] : (int) $t['proposer_id'];
            if ($uid !== $mustBe) { throw new HttpException(403, 'FORBIDDEN', $status === 'declined' ? 'Só quem recebeu a proposta pode recusá-la.' : 'Só quem propôs pode cancelar.'); }
            $msg = is_string($r->input('message')) ? mb_substr(trim((string) $r->input('message')), 0, 500) : '';
            Database::exec('UPDATE trades SET status = ?, response = ?, responded_at = ?, updated_at = ? WHERE id = ?', [$status, $msg, Repo::now(), Repo::now(), $t['id']]);
            $me = Social::briefs([$uid])[$uid];
            $other = $uid === (int) $t['proposer_id'] ? (int) $t['recipient_id'] : (int) $t['proposer_id'];
            Social::notify($other, $uid, 'trade', $status === 'declined' ? "@{$me['username']} recusou sua troca" : "@{$me['username']} cancelou a proposta de troca", 'trade', $t['public_id']);
            return self::out(Database::one('SELECT * FROM trades WHERE id = ?', [$t['id']]), $uid);
        });
    }
}
