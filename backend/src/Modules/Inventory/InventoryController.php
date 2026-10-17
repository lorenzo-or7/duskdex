<?php
declare(strict_types=1);

namespace DuskDex\Modules\Inventory;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Shared\Repo;

/**
 * Movimentações de inventário com prévia, confirmação idempotente e reversão por operação compensatória.
 * O histórico é somente-inserção: reverter cria um NOVO lote; o original fica intacto e marcado.
 */
final class InventoryController
{
    private static function copies(int $uid, array $pubs, bool $lock = false): array
    {
        $pubs = array_values(array_unique(array_filter($pubs, 'is_string')));
        if (!$pubs) { return []; }
        if (count($pubs) > 1000) { throw HttpException::validation('Selecione no máximo 1000 cartas por vez.'); }
        $in = implode(',', array_fill(0, count($pubs), '?'));
        $rows = Database::all("SELECT * FROM card_copies WHERE owner_id = ? AND public_id IN ($in) ORDER BY id" . ($lock ? ' FOR UPDATE' : ''), array_merge([$uid], $pubs));
        $by = [];
        foreach ($rows as $r) { $by[$r['public_id']] = $r; }
        return $by;
    }

    private static function token(array $pubs, array $by): string
    {
        return implode(',', array_map(function ($id) use ($by) {
            $c = $by[$id] ?? null;
            if (!$c) { return $id; }
            $slot = $c['slot_binder_id'] !== null ? Repo::pub('binders', (int) $c['slot_binder_id']) . '/' . $c['slot_page_id'] . '/' . $c['slot_index'] : '';
            return $id . '@' . Repo::pub('storage_locations', (int) $c['location_id']) . '@' . $slot;
        }, $pubs));
    }

    private static function dest(int $uid, mixed $pub): array
    {
        $d = is_string($pub) ? Database::one('SELECT * FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$pub, $uid]) : null;
        if (!$d || $d['is_hidden']) { throw HttpException::validation('Escolha um destino válido.'); }
        return $d;
    }

    private static function where(array $c): string
    {
        if ($c['slot_binder_id'] !== null) {
            $b = Database::one('SELECT name, pages FROM binders WHERE id = ?', [$c['slot_binder_id']]);
            $pn = 0;
            foreach (Repo::decode($b['pages'] ?? '[]') as $i => $p) { if ($p['id'] === $c['slot_page_id']) { $pn = $i + 1; } }
            return ($b['name'] ?? 'Fichário') . " · pág. $pn · bolso " . ((int) $c['slot_index'] + 1);
        }
        return Database::one('SELECT name FROM storage_locations WHERE id = ?', [$c['location_id']])['name'] ?? '—';
    }

    public static function previewMove(Request $r): array
    {
        $uid = (int) Security::userId();
        $pubs = (array) $r->input('copyIds', []);
        $dest = self::dest($uid, $r->input('locationId'));
        $by = self::copies($uid, $pubs);
        $items = []; $blocked = [];
        foreach ($pubs as $id) {
            $c = $by[$id] ?? null;
            if (!$c || $c['status'] === 'removed') { continue; }
            $out = InventoryRepo::copyOut($c);
            if ($c['deck_assembled']) { $blocked[] = ['copy' => $out, 'reason' => 'Montada em deck físico — desmonte o deck antes.']; continue; }
            if ((int) $c['location_id'] === (int) $dest['id'] && $c['slot_binder_id'] === null) { $blocked[] = ['copy' => $out, 'reason' => 'Já está neste local.']; continue; }
            if ($dest['binder_id'] !== null) { $blocked[] = ['copy' => $out, 'reason' => 'Para colocar em um fichário, use o editor do fichário (escolha o bolso).']; continue; }
            if ($dest['deck_id'] !== null) { $blocked[] = ['copy' => $out, 'reason' => 'Use a montagem do deck para movê-la para um deck.']; continue; }
            $items[] = ['copy' => $out, 'from' => self::where($c), 'warning' => $c['reserved_for'] !== null ? 'Reservada para um deck (a reserva continua).' : ($c['slot_binder_id'] !== null ? 'O bolso de origem ficará vazio.' : null)];
        }
        $cap = null;
        if ($dest['capacity'] !== null) {
            $count = (int) Database::one("SELECT COUNT(*) n FROM card_copies WHERE location_id = ? AND status = 'active'", [$dest['id']])['n'];
            if ($count + count($items) > (int) $dest['capacity']) { $cap = "O destino tem capacidade para {$dest['capacity']} e ficará com " . ($count + count($items)) . '.'; }
        }
        return ['dest' => ['id' => $dest['public_id'], 'name' => $dest['name'], 'capacity' => $dest['capacity'] !== null ? (int) $dest['capacity'] : null],
            'items' => $items, 'blocked' => $blocked, 'capacityWarn' => $cap, 'token' => self::token($pubs, $by)];
    }

    public static function commitMove(Request $r): array
    {
        $uid = (int) Security::userId();
        $pubs = (array) $r->input('copyIds', []);
        $idem = $r->input('idempotencyKey');
        $idem = is_string($idem) && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $idem) ? $idem : null;
        $token = $r->input('token');
        return Database::transaction(function () use ($uid, $pubs, $idem, $token, $r) {
            if ($idem) {
                $prev = Database::one('SELECT id FROM inventory_batches WHERE owner_id = ? AND idempotency_key = ?', [$uid, $idem]);
                if ($prev) { return InventoryRepo::batchOne($uid, (int) $prev['id']); } // repetição segura
            }
            $dest = self::dest($uid, $r->input('locationId'));
            if ($dest['binder_id'] !== null || $dest['deck_id'] !== null) { throw HttpException::validation('Destino inválido para movimentação direta.'); }
            $by = self::copies($uid, $pubs, true);
            if (is_string($token) && $token !== '' && self::token($pubs, $by) !== $token) {
                throw HttpException::conflict('Algumas cartas mudaram de lugar depois da prévia. Gere a prévia novamente.');
            }
            $batchId = 0; $n = 0;
            foreach ($by as $c) {
                if ($c['status'] === 'removed' || $c['deck_assembled']) { continue; }
                if ((int) $c['location_id'] === (int) $dest['id'] && $c['slot_binder_id'] === null) { continue; }
                if (!$batchId) { $batchId = InventoryRepo::createBatch($uid, 'move', "Movimentação para “{$dest['name']}”", $idem); }
                $fromSlot = InventoryRepo::slotJson($c['slot_binder_id'] !== null ? (int) $c['slot_binder_id'] : null, $c['slot_page_id'], $c['slot_index'] !== null ? (int) $c['slot_index'] : null);
                if ($c['slot_binder_id'] !== null) { BinderService::clearSlotForCopy((int) $c['slot_binder_id'], $c['slot_page_id'], (int) $c['slot_index'], $c['public_id']); }
                InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'], ['locationId' => (int) $c['location_id'], 'slot' => $fromSlot], ['locationId' => (int) $dest['id'], 'slot' => null]);
                Database::exec('UPDATE card_copies SET location_id = ?, slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL, updated_at = ? WHERE id = ?', [$dest['id'], Repo::now(), $c['id']]);
                $n++;
            }
            if (!$n) { throw HttpException::rule('NOTHING', 'Nenhuma carta precisou ser movida.'); }
            Repo::activity($uid, 'move', "$n carta(s) movida(s) para “{$dest['name']}”", 'move');
            return InventoryRepo::batchOne($uid, $batchId);
        });
    }

    // ------------------------------------------------------------ reversão

    /** Estado atual do bolso: id público da cópia que o ocupa, null (vazio/fantasma), 'other' ou 'missing'. */
    private static function slotState(int $uid, array $slot): array
    {
        $b = Database::one('SELECT id, pages FROM binders WHERE public_id = ? AND owner_id = ?', [$slot['binderId'] ?? '', $uid]);
        if (!$b) { return ['exists' => false]; }
        foreach (Repo::decode($b['pages']) as $p) {
            if ($p['id'] === ($slot['pageId'] ?? null)) {
                $s = $p['slots'][(int) ($slot['index'] ?? -1)] ?? null;
                if (!$s) { return ['exists' => true, 'occupant' => 'missing', 'locked' => false]; }
                $occ = $s['kind'] === 'copy' ? ($s['copyId'] ?? 'other') : (in_array($s['kind'], ['empty', 'ghost'], true) ? null : 'other');
                return ['exists' => true, 'occupant' => $occ, 'locked' => !empty($s['locked']), 'binderId' => (int) $b['id']];
            }
        }
        return ['exists' => true, 'occupant' => 'missing', 'locked' => false];
    }

    private static function sameSlot(?array $a, ?array $b): bool
    {
        if (!$a && !$b) { return true; }
        return $a && $b && ($a['binderId'] ?? null) === ($b['binderId'] ?? null) && ($a['pageId'] ?? null) === ($b['pageId'] ?? null) && (int) ($a['index'] ?? -1) === (int) ($b['index'] ?? -2);
    }

    /** Mesmas regras de features/domain.js → revertConflicts. */
    private static function conflicts(int $uid, array $m, ?array $copy): array
    {
        if (!$copy || $copy['status'] === 'removed') { return ['A cópia foi removida da coleção depois desta operação.']; }
        $out = [];
        $curSlot = InventoryRepo::slotJson($copy['slot_binder_id'] !== null ? (int) $copy['slot_binder_id'] : null, $copy['slot_page_id'], $copy['slot_index'] !== null ? (int) $copy['slot_index'] : null);
        $atDest = (int) $copy['location_id'] === (int) $m['to_location_id'] && self::sameSlot($curSlot, Repo::decode($m['to_slot'], null));
        if (!$atDest) { $out[] = 'A cópia foi movida novamente depois desta operação.'; }
        if ($copy['reserved_for'] !== null && $copy['deck_assembled']) { $out[] = 'A cópia está montada em um deck físico.'; }
        if ($m['from_location_id'] !== null && !Database::one('SELECT 1 FROM storage_locations WHERE id = ? AND owner_id = ?', [$m['from_location_id'], $uid])) { $out[] = 'O local de origem não existe mais.'; }
        $from = Repo::decode($m['from_slot'], null);
        if ($from) {
            $st = self::slotState($uid, $from);
            if (!$st['exists']) { $out[] = 'O fichário de origem não existe mais.'; }
            else {
                if ($st['occupant'] !== null && $st['occupant'] !== $copy['public_id']) { $out[] = 'O bolso de origem já está ocupado por outra carta.'; }
                if ($st['locked']) { $out[] = 'O bolso de origem está bloqueado.'; }
            }
        }
        return $out;
    }

    private static function batchRow(int $uid, string $pub, bool $lock = false): array
    {
        $b = Database::one('SELECT * FROM inventory_batches WHERE public_id = ? AND owner_id = ?' . ($lock ? ' FOR UPDATE' : ''), [$pub, $uid]);
        if (!$b) { throw HttpException::notFound('Operação não encontrada.'); }
        return $b;
    }

    public static function previewRevert(Request $r): array
    {
        $uid = (int) Security::userId();
        $b = self::batchRow($uid, $r->params['id']);
        $batch = InventoryRepo::batchOne($uid, (int) $b['id']);
        $mvs = Database::all('SELECT m.*, r.movement_id AS reverted FROM inventory_movements m LEFT JOIN movement_reversions r ON r.movement_id = m.id WHERE m.batch_id = ? ORDER BY m.id', [$b['id']]);
        $outById = [];
        foreach ($batch['movements'] as $mv) { $outById[$mv['id']] = $mv; }
        $items = [];
        foreach ($mvs as $m) {
            $mv = $outById[$m['public_id']];
            if ($m['reverted'] !== null) { $items[] = ['movement' => $mv, 'conflicts' => ['Este movimento já foi revertido.'], 'already' => true]; continue; }
            $copy = Database::one('SELECT * FROM card_copies WHERE id = ? AND owner_id = ?', [$m['copy_id'], $uid]);
            $items[] = ['movement' => $mv, 'copy' => $copy ? InventoryRepo::copyOut($copy) : null, 'conflicts' => self::conflicts($uid, $m, $copy)];
        }
        return ['batch' => $batch, 'items' => $items];
    }

    public static function revert(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = array_values(array_filter((array) $r->input('movementIds', []), 'is_string'));
        if (!$ids) { throw HttpException::validation('Selecione os movimentos a reverter.'); }
        return Database::transaction(function () use ($uid, $ids, $r) {
            $b = self::batchRow($uid, $r->params['id'], true);
            $in = implode(',', array_fill(0, count($ids), '?'));
            $mvs = Database::all("SELECT m.*, r.movement_id AS reverted FROM inventory_movements m LEFT JOIN movement_reversions r ON r.movement_id = m.id WHERE m.batch_id = ? AND m.public_id IN ($in) ORDER BY m.id", array_merge([$b['id']], $ids));
            $removed = Repo::systemLocation($uid, 'removed');
            $revId = 0; $n = 0;
            foreach ($mvs as $m) {
                if ($m['reverted'] !== null) { continue; }
                $copy = Database::one('SELECT * FROM card_copies WHERE id = ? AND owner_id = ? FOR UPDATE', [$m['copy_id'], $uid]);
                $conf = self::conflicts($uid, $m, $copy);
                if ($conf) { throw HttpException::conflict('Não é possível reverter: ' . $conf[0], $conf); }
                // origem nula = aquisição → a compensação é retirar a cópia da coleção
                $targetLoc = $m['from_location_id'] !== null ? (int) $m['from_location_id'] : $removed;
                $targetSlot = Repo::decode($m['from_slot'], null);
                $curSlot = InventoryRepo::slotJson($copy['slot_binder_id'] !== null ? (int) $copy['slot_binder_id'] : null, $copy['slot_page_id'], $copy['slot_index'] !== null ? (int) $copy['slot_index'] : null);
                if ($copy['slot_binder_id'] !== null) {
                    BinderService::clearSlotForCopy((int) $copy['slot_binder_id'], $copy['slot_page_id'], (int) $copy['slot_index'], $copy['public_id']);
                    Database::exec('UPDATE card_copies SET slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL WHERE id = ?', [$copy['id']]);
                }
                $tb = null;
                if ($targetSlot) {
                    $st = self::slotState($uid, $targetSlot);
                    $tb = $st['binderId'];
                    BinderService::putCopyInSlot($tb, $targetSlot['pageId'], (int) $targetSlot['index'], $copy['public_id'], $copy['card_key']);
                }
                if (!$revId) {
                    $revId = InventoryRepo::createBatch($uid, 'revert', "Reversão de “{$b['label']}”");
                    Database::exec('UPDATE inventory_batches SET reverts_batch_id = ? WHERE id = ?', [$b['id'], $revId]);
                }
                $status = $targetLoc === $removed ? 'removed' : 'active';
                Database::exec('UPDATE card_copies SET location_id = ?, slot_binder_id = ?, slot_page_id = ?, slot_index = ?, status = ?, deck_assembled = 0, updated_at = ? WHERE id = ?',
                    [$targetLoc, $tb, $targetSlot['pageId'] ?? null, $targetSlot ? (int) $targetSlot['index'] : null, $status, Repo::now(), $copy['id']]);
                InventoryRepo::movement($revId, (int) $copy['id'], $copy['card_key'], ['locationId' => (int) $copy['location_id'], 'slot' => $curSlot], ['locationId' => $targetLoc, 'slot' => $targetSlot], (int) $m['id']);
                Database::exec('INSERT INTO movement_reversions (movement_id, revert_batch_id, created_at) VALUES (?, ?, ?)', [$m['id'], $revId, Repo::now()]);
                $n++;
            }
            if (!$n) { throw HttpException::rule('NOTHING', 'Nenhum movimento selecionado pôde ser revertido.'); }
            Repo::activity($uid, 'revert', "$n movimento(s) revertido(s) de “{$b['label']}”", 'undo');
            return InventoryRepo::batchOne($uid, $revId);
        });
    }
}
