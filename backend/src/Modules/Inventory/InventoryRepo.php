<?php
declare(strict_types=1);

namespace DuskDex\Modules\Inventory;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Shared\Repo;

/** Mapeamento de cópias/lotes para o formato da API e registro de movimentações (somente inserção). */
final class InventoryRepo
{
    public static function copyOut(array $c, array $binderPub = []): array
    {
        $slot = null;
        if ($c['slot_binder_id'] !== null) {
            $slot = ['binderId' => $binderPub[(int) $c['slot_binder_id']] ?? Repo::pub('binders', (int) $c['slot_binder_id']), 'pageId' => $c['slot_page_id'], 'index' => (int) $c['slot_index']];
        }
        return [
            'id' => $c['public_id'], 'cardKey' => $c['card_key'], 'cardId' => $c['card_id'], 'lang' => $c['lang'], 'finish' => $c['finish'], 'condition' => $c['card_condition'] ?? 'NM',
            'custom' => (bool) $c['is_custom'], 'status' => $c['status'], 'locationId' => Repo::pub('storage_locations', (int) $c['location_id']),
            'slot' => $slot, 'reservedFor' => $c['reserved_for'] !== null ? Repo::pub('decks', (int) $c['reserved_for']) : null,
            'deckAssembled' => (bool) $c['deck_assembled'], 'forTrade' => (bool) ($c['for_trade'] ?? false), 'viaTrade' => ($c['origin_trade_id'] ?? null) !== null, 'createdAt' => Repo::iso($c['created_at']), 'updatedAt' => Repo::iso($c['updated_at']),
        ];
    }

    public static function slotJson(?int $binderId, ?string $pageId, ?int $index): ?array
    {
        return $binderId === null ? null : ['binderId' => Repo::pub('binders', $binderId), 'pageId' => $pageId, 'index' => $index];
    }

    public static function createBatch(int $ownerId, string $type, string $label, ?string $idem = null): int
    {
        $pub = Ulid::generate();
        $id = Database::insert('INSERT INTO inventory_batches (public_id, owner_id, type, label, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)', [$pub, $ownerId, $type, mb_substr($label, 0, 160), $idem, Repo::now()]);
        Repo::remember('inventory_batches', $id, $pub);
        return $id;
    }

    /** @param array{locationId:?int, slot:?array} $from @param array{locationId:?int, slot:?array} $to */
    /** @param array{locationId:?int, slot:?array} $from @param array{locationId:?int, slot:?array} $to */
    public static function movement(int $batchId, int $copyId, string $cardKey, array $from, array $to, ?int $revertsMovementId = null): void
    {
        Database::exec('INSERT INTO inventory_movements (public_id, batch_id, copy_id, card_key, from_location_id, from_slot, to_location_id, to_slot, reverts_movement_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            Ulid::generate(), $batchId, $copyId, $cardKey, $from['locationId'], $from['slot'] ? Repo::json($from['slot']) : null,
            $to['locationId'], $to['slot'] ? Repo::json($to['slot']) : null, $revertsMovementId, Repo::now(),
        ]);
    }

    public static function batches(int $ownerId, int $limit = 200, ?int $onlyId = null): array
    {
        $batches = $onlyId !== null
            ? Database::all('SELECT id, public_id, type, label, reverts_batch_id, created_at FROM inventory_batches WHERE owner_id = ? AND id = ?', [$ownerId, $onlyId])
            : Database::all("SELECT id, public_id, type, label, reverts_batch_id, created_at FROM inventory_batches WHERE owner_id = ? ORDER BY id DESC LIMIT $limit", [$ownerId]);
        if (!$batches) {
            return [];
        }
        $ids = array_column($batches, 'id');
        $in = implode(',', array_fill(0, count($ids), '?'));
        $mvs = Database::all("SELECT m.public_id, m.batch_id, c.public_id AS copy_pub, m.card_key, m.from_location_id, m.from_slot, m.to_location_id, m.to_slot, rm.public_id AS reverts_pub, r.movement_id AS reverted
            FROM inventory_movements m JOIN card_copies c ON c.id = m.copy_id
            LEFT JOIN inventory_movements rm ON rm.id = m.reverts_movement_id
            LEFT JOIN movement_reversions r ON r.movement_id = m.id
            WHERE m.batch_id IN ($in) ORDER BY m.id", $ids);
        $by = []; $reverted = [];
        foreach ($mvs as $m) {
            $by[(int) $m['batch_id']][] = array_filter([
                'id' => $m['public_id'], 'copyId' => $m['copy_pub'], 'cardKey' => $m['card_key'],
                'from' => ['locationId' => Repo::pub('storage_locations', $m['from_location_id'] !== null ? (int) $m['from_location_id'] : null), 'slot' => Repo::decode($m['from_slot'], null)],
                'to' => ['locationId' => Repo::pub('storage_locations', $m['to_location_id'] !== null ? (int) $m['to_location_id'] : null), 'slot' => Repo::decode($m['to_slot'], null)],
                'revertsMovementId' => $m['reverts_pub'],
            ], fn ($v) => $v !== null);
            if ($m['reverted'] !== null) { $reverted[(int) $m['batch_id']][] = $m['public_id']; }
        }
        return array_map(fn ($b) => [
            'id' => $b['public_id'], 'type' => $b['type'], 'label' => $b['label'], 'createdAt' => Repo::iso($b['created_at']),
            'revertsBatchId' => $b['reverts_batch_id'] !== null ? Repo::pub('inventory_batches', (int) $b['reverts_batch_id']) : null,
            'revertedMovementIds' => $reverted[(int) $b['id']] ?? [], 'movements' => $by[(int) $b['id']] ?? [],
        ], $batches);
    }

    public static function batchOne(int $ownerId, int $batchId): array
    {
        return self::batches($ownerId, 1, $batchId)[0] ?? throw new \RuntimeException('Lote não encontrado.');
    }
}
