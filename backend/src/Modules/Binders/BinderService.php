<?php
declare(strict_types=1);

namespace DuskDex\Modules\Binders;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Modules\Inventory\InventoryRepo;
use DuskDex\Modules\Shared\Repo;

/**
 * Regras de edição de fichários aplicadas de forma ATÔMICA (uma transação por pedido).
 * - Uma cópia física só pode estar em um bolso (UNIQUE no banco + verificação aqui).
 * - Colocar uma cópia em um bolso a retira do local/bolso anterior na mesma transação.
 * - Bolsos bloqueados só aceitam carta fantasma.
 * - Versão otimista: conflito entre dispositivos → 409.
 */
final class BinderService
{
    public static function newPage(int $rows, int $cols): array
    {
        $id = 'p' . substr(base_convert(bin2hex(random_bytes(6)), 16, 36), 0, 9);
        return ['id' => $id, 'rows' => $rows, 'cols' => $cols, 'slots' => array_fill(0, $rows * $cols, ['kind' => 'empty', 'locked' => false])];
    }

    public static function out(array $b): array
    {
        return [
            'id' => $b['public_id'], 'name' => $b['name'], 'description' => $b['description'], 'type' => $b['type'],
            'layout' => ['rows' => (int) $b['layout_rows'], 'cols' => (int) $b['layout_cols']], 'pages' => Repo::decode($b['pages']),
            'appearance' => Repo::decode($b['appearance'], new \stdClass()), 'locationId' => $b['location_id'] !== null ? Repo::pub('storage_locations', (int) $b['location_id']) : null,
            'visibility' => $b['visibility'], 'favorite' => (bool) $b['favorite'], 'version' => (int) $b['version'],
            'createdAt' => Repo::iso($b['created_at']), 'updatedAt' => Repo::iso($b['updated_at']),
        ];
    }

    /** Libera o bolso de uma cópia (usado por remoção/movimentação). Deve rodar dentro de transação. */
    public static function clearSlotForCopy(int $binderId, string $pageId, int $index, string $copyPub): void
    {
        $b = Database::one('SELECT id, pages, version FROM binders WHERE id = ? FOR UPDATE', [$binderId]);
        if (!$b) { return; }
        $pages = Repo::decode($b['pages']);
        foreach ($pages as &$p) {
            if ($p['id'] === $pageId && isset($p['slots'][$index]) && ($p['slots'][$index]['kind'] ?? '') === 'copy' && ($p['slots'][$index]['copyId'] ?? '') === $copyPub) {
                $p['slots'][$index] = ['kind' => 'empty', 'locked' => (bool) ($p['slots'][$index]['locked'] ?? false)];
            }
        }
        unset($p);
        Database::exec('UPDATE binders SET pages = ?, version = version + 1, updated_at = ? WHERE id = ?', [Repo::json($pages), Repo::now(), $binderId]);
    }

    /** Coloca uma cópia em um bolso (reversão de movimento). Deve rodar dentro de transação. */
    public static function putCopyInSlot(int $binderId, string $pageId, int $index, string $copyPub, string $cardKey): void
    {
        $b = Database::one('SELECT id, pages FROM binders WHERE id = ? FOR UPDATE', [$binderId]);
        if (!$b) { throw HttpException::conflict('O fichário de origem não existe mais.'); }
        $pages = Repo::decode($b['pages']);
        $s = &self::slot($pages, $pageId, $index);
        if ($s['kind'] === 'copy' && ($s['copyId'] ?? '') !== $copyPub) { throw HttpException::conflict('O bolso de origem já está ocupado por outra carta.'); }
        if (!in_array($s['kind'], ['empty', 'ghost', 'copy'], true)) { throw HttpException::conflict('O bolso de origem tem outro conteúdo.'); }
        $s = ['kind' => 'copy', 'copyId' => $copyPub, 'cardKey' => $cardKey, 'locked' => false];
        unset($s);
        Database::exec('UPDATE binders SET pages = ?, version = version + 1, updated_at = ? WHERE id = ?', [Repo::json($pages), Repo::now(), $binderId]);
    }

    private static function &slot(array &$pages, mixed $pageId, mixed $index): array
    {
        foreach ($pages as &$p) {
            if ($p['id'] === $pageId) {
                if (!is_int($index) || $index < 0 || $index >= count($p['slots'])) {
                    throw HttpException::rule('SLOT_NOT_FOUND', 'Bolso inexistente nesta página.');
                }
                return $p['slots'][$index];
            }
        }
        throw HttpException::rule('PAGE_NOT_FOUND', 'Página não encontrada no fichário.');
    }

    private static function validKey(int $uid, mixed $key): string
    {
        if (!is_string($key) || !preg_match('/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/', $key)) {
            throw HttpException::validation('Carta inválida para o bolso.');
        }
        if (!Database::one('SELECT 1 FROM user_cards WHERE owner_id = ? AND card_key = ?', [$uid, $key])) {
            throw HttpException::validation('Registre a carta (POST /cards) antes de usá-la no fichário.');
        }
        return $key;
    }

    /** Bolso com imagem própria: recorte simples {x,y,scale} ou pedaço de panorama. Valores com limites. */
    private static function imageSlot(int $uid, array $in): array
    {
        $pub = $in['assetId'] ?? null;
        \DuskDex\Modules\Assets\AssetController::ownedId($uid, $pub);
        $num = function (mixed $v, float $min, float $max, float $def): float {
            return is_numeric($v) ? max($min, min($max, (float) $v)) : $def;
        };
        $out = ['kind' => 'image', 'assetId' => $pub];
        if (isset($in['panorama']) && is_array($in['panorama'])) {
            $p = $in['panorama'];
            if (!is_string($p['id'] ?? null) || !preg_match('/^[A-Za-z0-9_-]{4,40}$/', $p['id'])) { throw HttpException::validation('Panorama inválido.'); }
            $rows = (int) ($p['rows'] ?? 0); $cols = (int) ($p['cols'] ?? 0);
            if ($rows < 1 || $rows > 6 || $cols < 1 || $cols > 6) { throw HttpException::validation('Panorama inválido.'); }
            $out['panorama'] = ['id' => $p['id'], 'rows' => $rows, 'cols' => $cols,
                'row' => max(0, min($rows - 1, (int) ($p['row'] ?? 0))), 'col' => max(0, min($cols - 1, (int) ($p['col'] ?? 0))),
                'gap' => $num($p['gap'] ?? 0, 0, 30, 0), 'x' => $num($p['x'] ?? 0.5, -1, 2, 0.5), 'y' => $num($p['y'] ?? 0.5, -1, 2, 0.5), 'scale' => $num($p['scale'] ?? 1, 0.1, 10, 1)];
        } else {
            $c = is_array($in['crop'] ?? null) ? $in['crop'] : [];
            $out['crop'] = ['x' => $num($c['x'] ?? 0.5, -1, 2, 0.5), 'y' => $num($c['y'] ?? 0.5, -1, 2, 0.5), 'scale' => $num($c['scale'] ?? 1, 0.1, 10, 1)];
        }
        return $out;
    }

    public static function ops(int $uid, string $binderPub, array $ops, ?int $expectedVersion, string $label): array
    {
        if (!$ops || count($ops) > 400) {
            throw HttpException::validation('Envie de 1 a 400 operações.');
        }
        return Database::transaction(function () use ($uid, $binderPub, $ops, $expectedVersion, $label) {
            $b = Database::one('SELECT * FROM binders WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$binderPub, $uid]);
            if (!$b) { throw HttpException::notFound('Fichário não encontrado.'); }
            if ($expectedVersion !== null && (int) $b['version'] !== $expectedVersion) {
                throw HttpException::conflict('O fichário foi alterado em outra aba ou dispositivo. Recarregue para ver a versão atual.');
            }
            $binderId = (int) $b['id'];
            $pages = Repo::decode($b['pages']);
            $copies = [];   // pub => row (travada)
            $final = [];    // pub => [location_id, binder_id, page_id, index]
            $moves = [];
            $others = [];   // binderId => pages

            $getCopy = function (string $pub) use (&$copies, $uid): array {
                if (!isset($copies[$pub])) {
                    $row = Database::one('SELECT * FROM card_copies WHERE public_id = ? AND owner_id = ? FOR UPDATE', [$pub, $uid]);
                    if (!$row || $row['status'] !== 'active') { throw HttpException::rule('NOT_FOUND', 'Cópia não encontrada na coleção.'); }
                    $copies[$pub] = $row;
                }
                return $copies[$pub];
            };
            $current = function (array $c) use (&$final): array {
                return $final[$c['public_id']] ?? [(int) $c['location_id'], $c['slot_binder_id'] !== null ? (int) $c['slot_binder_id'] : null, $c['slot_page_id'], $c['slot_index'] !== null ? (int) $c['slot_index'] : null];
            };
            $setPos = function (array $c, array $to) use (&$final, &$moves, $current): void {
                $from = $current($c);
                if ($from !== $to) {
                    $moves[] = [$c, $from, $to];
                    $final[$c['public_id']] = $to;
                }
            };

            foreach ($ops as $op) {
                $type = $op['op'] ?? '';
                switch ($type) {
                    case 'set': {
                        $s = &self::slot($pages, $op['pageId'] ?? null, $op['index'] ?? null);
                        $kind = $op['slot']['kind'] ?? '';
                        if ($s['kind'] === 'copy') { throw HttpException::rule('HAS_COPY', 'Este bolso tem uma carta física. Retire-a primeiro.'); }
                        if (!in_array($kind, ['empty', 'ghost', 'virtual', 'image'], true)) { throw HttpException::validation('Tipo de conteúdo inválido.'); }
                        if ($kind === 'virtual' && $b['type'] !== 'virtual') { throw HttpException::rule('NOT_ALLOWED', 'Referências virtuais são para fichários virtuais. Use carta fantasma.'); }
                        if (!empty($s['locked']) && in_array($kind, ['virtual', 'image'], true)) { throw HttpException::rule('LOCKED', 'Bolso bloqueado: só aceita carta fantasma.'); }
                        $locked = (bool) ($s['locked'] ?? false);
                        $s = match ($kind) {
                            'empty' => ['kind' => 'empty', 'locked' => $locked],
                            'image' => self::imageSlot($uid, $op['slot']) + ['locked' => $locked],
                            default => ['kind' => $kind, 'cardKey' => self::validKey($uid, $op['slot']['cardKey'] ?? null), 'locked' => $locked],
                        };
                        unset($s);
                        break;
                    }
                    case 'place': {
                        if ($b['type'] !== 'physical') { throw HttpException::rule('NOT_ALLOWED', 'Fichários virtuais não recebem cópias físicas.'); }
                        $s = &self::slot($pages, $op['pageId'] ?? null, $op['index'] ?? null);
                        if (!empty($s['locked'])) { throw HttpException::rule('LOCKED', 'Bolso bloqueado. Desbloqueie para colocar uma carta física.'); }
                        if (!in_array($s['kind'], ['empty', 'ghost'], true)) { throw HttpException::rule('OCCUPIED', 'Este bolso já está ocupado.'); }
                        $c = $getCopy((string) ($op['copyId'] ?? ''));
                        if ($c['deck_assembled']) { throw HttpException::rule('IN_DECK', 'Esta cópia está montada em um deck físico.'); }
                        $cur = $current($c);
                        if ($cur[1] !== null) {
                            if ($cur[1] === $binderId) {
                                $prev = &self::slot($pages, $cur[2], $cur[3]);
                                if (($prev['copyId'] ?? '') === $c['public_id']) { $prev = ['kind' => 'empty', 'locked' => (bool) ($prev['locked'] ?? false)]; }
                                unset($prev);
                            } else {
                                if (!isset($others[$cur[1]])) {
                                    $ob = Database::one('SELECT pages FROM binders WHERE id = ? AND owner_id = ? FOR UPDATE', [$cur[1], $uid]);
                                    $others[$cur[1]] = Repo::decode($ob['pages'] ?? '[]');
                                }
                                $prev = &self::slot($others[$cur[1]], $cur[2], $cur[3]);
                                if (($prev['copyId'] ?? '') === $c['public_id']) { $prev = ['kind' => 'empty', 'locked' => (bool) ($prev['locked'] ?? false)]; }
                                unset($prev);
                            }
                        }
                        $s = ['kind' => 'copy', 'copyId' => $c['public_id'], 'cardKey' => $c['card_key'], 'locked' => false];
                        unset($s);
                        $setPos($c, [(int) $b['location_id'], $binderId, $op['pageId'], $op['index']]);
                        break;
                    }
                    case 'unplace': {
                        $s = &self::slot($pages, $op['pageId'] ?? null, $op['index'] ?? null);
                        if ($s['kind'] !== 'copy') { $s = ['kind' => 'empty', 'locked' => (bool) ($s['locked'] ?? false)]; unset($s); break; }
                        $destPub = $op['toLocationId'] ?? null;
                        $dest = $destPub ? Database::one('SELECT id, is_hidden, binder_id FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$destPub, $uid]) : ['id' => Repo::systemLocation($uid, 'inbox'), 'is_hidden' => 0, 'binder_id' => null];
                        if (!$dest || $dest['is_hidden'] || $dest['binder_id'] !== null) { throw HttpException::validation('Destino inválido para a carta retirada.'); }
                        $c = $getCopy($s['copyId']);
                        $s = !empty($op['leaveGhost']) ? ['kind' => 'ghost', 'cardKey' => $s['cardKey'], 'locked' => (bool) ($s['locked'] ?? false)] : ['kind' => 'empty', 'locked' => (bool) ($s['locked'] ?? false)];
                        unset($s);
                        $setPos($c, [(int) $dest['id'], null, null, null]);
                        break;
                    }
                    case 'swap':
                    case 'move': {
                        $A = &self::slot($pages, $op['a']['pageId'] ?? null, $op['a']['index'] ?? null);
                        $B = &self::slot($pages, $op['b']['pageId'] ?? null, $op['b']['index'] ?? null);
                        $ok = fn ($x) => in_array($x['kind'], ['empty', 'ghost'], true);
                        if ((!empty($B['locked']) && !$ok($A)) || (!empty($A['locked']) && !$ok($B))) { throw HttpException::rule('LOCKED', 'Bolsos bloqueados só aceitam cartas fantasmas.'); }
                        if ($type === 'move' && $B['kind'] !== 'empty') { throw HttpException::rule('OCCUPIED', 'O destino não está vazio. Use “trocar”.'); }
                        $sa = $A; $sb = $B;
                        $sa['locked'] = (bool) ($B['locked'] ?? false); $sb['locked'] = (bool) ($A['locked'] ?? false);
                        $A = $sb; $B = $sa;
                        unset($A, $B);
                        if ($sa['kind'] === 'copy') { $setPos($getCopy($sa['copyId']), [(int) $b['location_id'], $binderId, $op['b']['pageId'], $op['b']['index']]); }
                        if ($sb['kind'] === 'copy') { $setPos($getCopy($sb['copyId']), [(int) $b['location_id'], $binderId, $op['a']['pageId'], $op['a']['index']]); }
                        break;
                    }
                    case 'lock': {
                        $s = &self::slot($pages, $op['pageId'] ?? null, $op['index'] ?? null);
                        if (!empty($op['locked']) && !in_array($s['kind'], ['empty', 'ghost'], true)) { throw HttpException::rule('NOT_ALLOWED', 'Só é possível bloquear bolsos vazios ou com carta fantasma.'); }
                        $s['locked'] = (bool) ($op['locked'] ?? false);
                        unset($s);
                        break;
                    }
                    case 'addPage': {
                        $rows = (int) ($op['rows'] ?? $b['layout_rows']); $cols = (int) ($op['cols'] ?? $b['layout_cols']);
                        if ($rows < 1 || $rows > 6 || $cols < 1 || $cols > 6) { throw HttpException::validation('Formato inválido.'); }
                        if (count($pages) >= 200) { throw HttpException::rule('LIMIT', 'Limite de 200 páginas por fichário.'); }
                        $idx = count($pages);
                        if (!empty($op['afterPageId'])) { foreach ($pages as $i => $p) { if ($p['id'] === $op['afterPageId']) { $idx = $i + 1; } } }
                        array_splice($pages, $idx, 0, [self::newPage($rows, $cols)]);
                        break;
                    }
                    case 'removePage': {
                        $found = false;
                        foreach ($pages as $i => $p) {
                            if ($p['id'] !== ($op['pageId'] ?? null)) { continue; }
                            $found = true;
                            foreach ($p['slots'] as $x) { if ($x['kind'] === 'copy') { throw HttpException::rule('HAS_COPY', 'A página tem cartas físicas. Retire-as antes.'); } }
                            if (count($pages) === 1) { throw HttpException::rule('LIMIT', 'O fichário precisa ter ao menos uma página.'); }
                            array_splice($pages, $i, 1);
                            break;
                        }
                        if (!$found) { throw HttpException::rule('PAGE_NOT_FOUND', 'Página não encontrada.'); }
                        break;
                    }
                    case 'layoutPage': {
                        $rows = (int) ($op['rows'] ?? 0); $cols = (int) ($op['cols'] ?? 0);
                        if ($rows < 1 || $rows > 6 || $cols < 1 || $cols > 6) { throw HttpException::validation('Formato inválido.'); }
                        foreach ($pages as &$p) {
                            if ($p['id'] !== ($op['pageId'] ?? null)) { continue; }
                            $size = $rows * $cols;
                            foreach (array_slice($p['slots'], $size) as $x) { if ($x['kind'] !== 'empty') { throw HttpException::rule('NOT_EMPTY', 'Os bolsos que deixariam de existir não estão vazios.'); } }
                            $slots = array_slice($p['slots'], 0, $size);
                            while (count($slots) < $size) { $slots[] = ['kind' => 'empty', 'locked' => false]; }
                            $p = ['id' => $p['id'], 'rows' => $rows, 'cols' => $cols, 'slots' => $slots];
                        }
                        unset($p);
                        break;
                    }
                    case 'arrange': {
                        $snapshot = [];
                        foreach ($op['moves'] ?? [] as $m) {
                            $s = &self::slot($pages, $m['from']['pageId'] ?? null, $m['from']['index'] ?? null);
                            if (!empty($s['locked'])) { throw HttpException::rule('LOCKED', 'A organização automática não move bolsos bloqueados.'); }
                            $snapshot[] = [$m, $s];
                            $s = ['kind' => 'empty', 'locked' => false];
                            unset($s);
                        }
                        foreach ($snapshot as [$m, $content]) {
                            $t = &self::slot($pages, $m['to']['pageId'] ?? null, $m['to']['index'] ?? null);
                            if (!empty($t['locked']) || $t['kind'] !== 'empty') { throw HttpException::conflict('O plano de organização ficou desatualizado. Gere a prévia novamente.'); }
                            $t = array_merge($content, ['locked' => false]);
                            unset($t);
                            if ($content['kind'] === 'copy') { $setPos($getCopy($content['copyId']), [(int) $b['location_id'], $binderId, $m['to']['pageId'], $m['to']['index']]); }
                        }
                        break;
                    }
                    default:
                        throw HttpException::validation("Operação desconhecida: $type");
                }
            }

            // Persistência em duas fases para não violar UNIQUE(bolso) durante trocas.
            $changed = array_keys($final);
            if ($changed) {
                $ids = array_map(fn ($pub) => (int) $copies[$pub]['id'], $changed);
                $in = implode(',', array_fill(0, count($ids), '?'));
                Database::exec("UPDATE card_copies SET slot_binder_id = NULL, slot_page_id = NULL, slot_index = NULL WHERE id IN ($in)", $ids);
                foreach ($final as $pub => [$loc, $bid, $pid, $idx]) {
                    Database::exec('UPDATE card_copies SET location_id = ?, slot_binder_id = ?, slot_page_id = ?, slot_index = ?, updated_at = ? WHERE id = ?', [$loc, $bid, $pid, $idx, Repo::now(), $copies[$pub]['id']]);
                }
            }
            foreach ($others as $obId => $obPages) {
                Database::exec('UPDATE binders SET pages = ?, version = version + 1, updated_at = ? WHERE id = ?', [Repo::json($obPages), Repo::now(), $obId]);
            }
            Database::exec('UPDATE binders SET pages = ?, version = version + 1, updated_at = ? WHERE id = ?', [Repo::json($pages), Repo::now(), $binderId]);

            $batch = null;
            if ($moves) {
                $batchId = InventoryRepo::createBatch($uid, 'reorganize', mb_substr("$label · {$b['name']}", 0, 160));
                foreach ($moves as [$c, $from, $to]) {
                    InventoryRepo::movement($batchId, (int) $c['id'], $c['card_key'],
                        ['locationId' => $from[0], 'slot' => InventoryRepo::slotJson($from[1], $from[2], $from[3])],
                        ['locationId' => $to[0], 'slot' => InventoryRepo::slotJson($to[1], $to[2], $to[3])]);
                }
                Repo::activity($uid, 'binder', count($moves) . " carta(s) reposicionada(s) em “{$b['name']}”", 'book');
                $batch = ['id' => Repo::pub('inventory_batches', $batchId), 'movements' => count($moves)];
            }
            $nb = Database::one('SELECT * FROM binders WHERE id = ?', [$binderId]);
            return ['binder' => self::out($nb), 'batch' => $batch];
        });
    }
}
