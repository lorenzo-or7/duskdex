<?php
declare(strict_types=1);

namespace DuskDex\Modules\Inventory;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Shared\Repo;

/** Árvore de locais de armazenamento (sem ciclos) e histórico de lotes. */
final class LocationController
{
    public const KINDS = ['room', 'shelf', 'drawer', 'box', 'folder', 'divider', 'custom'];

    public static function index(Request $r): array
    {
        $rows = Database::all('SELECT l.*, b.public_id AS binder_pub, d.public_id AS deck_pub FROM storage_locations l LEFT JOIN binders b ON b.id = l.binder_id LEFT JOIN decks d ON d.id = l.deck_id WHERE l.owner_id = ? ORDER BY l.id', [Security::userId()]);
        $pub = [];
        foreach ($rows as $l) { $pub[(int) $l['id']] = $l['public_id']; }
        return array_map(fn ($l) => [
            'id' => $l['public_id'], 'name' => $l['name'], 'kind' => $l['kind'], 'parentId' => $l['parent_id'] !== null ? ($pub[(int) $l['parent_id']] ?? null) : null,
            'description' => $l['description'], 'capacity' => $l['capacity'] !== null ? (int) $l['capacity'] : null,
            'system' => (bool) $l['is_system'], 'hidden' => (bool) $l['is_hidden'], 'binderId' => $l['binder_pub'], 'deckId' => $l['deck_pub'], 'createdAt' => Repo::iso($l['created_at']),
        ], $rows);
    }

    private static function find(string $pub, int $uid): array
    {
        $l = Database::one('SELECT * FROM storage_locations WHERE public_id = ? AND owner_id = ?', [$pub, $uid]);
        if (!$l) { throw HttpException::notFound('Local não encontrado.'); }
        return $l;
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $v = new Validator($r->json());
        $name = $v->str('name', 1, 60, true, null, 'Nome');
        $kind = $v->in('kind', self::KINDS, false, 'custom');
        $desc = (string) $v->str('description', 0, 300, false);
        $cap = $v->int('capacity', 1, 100000, false);
        $v->check();
        $parentId = null;
        if ($p = $r->input('parentId')) {
            $parent = self::find((string) $p, $uid);
            if ($parent['is_hidden']) { throw HttpException::validation('Local pai inválido.'); }
            $parentId = (int) $parent['id'];
        }
        $pub = Ulid::generate();
        Database::insert('INSERT INTO storage_locations (public_id, owner_id, parent_id, name, kind, description, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$pub, $uid, $parentId, $name, $kind, $desc, $cap, Repo::now()]);
        Repo::activity($uid, 'location', "Local “{$name}” criado", 'box');
        return self::one($pub, $uid);
    }

    public static function update(Request $r): array
    {
        $uid = (int) Security::userId();
        $l = self::find($r->params['id'], $uid);
        if ($l['is_system']) { throw new HttpException(403, 'FORBIDDEN', 'Locais do sistema não podem ser editados.'); }
        $in = $r->json();
        $v = new Validator($in);
        $sets = []; $params = [];
        if (array_key_exists('name', $in)) { $sets[] = 'name = ?'; $params[] = $v->str('name', 1, 60, true, null, 'Nome'); }
        if (array_key_exists('description', $in)) { $sets[] = 'description = ?'; $params[] = (string) $v->str('description', 0, 300, false); }
        if (array_key_exists('capacity', $in)) { $sets[] = 'capacity = ?'; $params[] = $v->int('capacity', 1, 100000, false); }
        if (array_key_exists('kind', $in) && $l['binder_id'] === null) { $sets[] = 'kind = ?'; $params[] = $v->in('kind', self::KINDS); }
        $v->check();
        if (array_key_exists('parentId', $in)) {
            $newParent = $in['parentId'] ? (int) self::find((string) $in['parentId'], $uid)['id'] : null;
            // impede ciclos: sobe a partir do novo pai até a raiz
            $cur = $newParent; $guard = 0;
            while ($cur !== null && $guard++ < 100) {
                if ($cur === (int) $l['id']) { throw HttpException::rule('CYCLE', 'Um local não pode ficar dentro de si mesmo ou de um de seus sublocais.'); }
                $row = Database::one('SELECT parent_id FROM storage_locations WHERE id = ?', [$cur]);
                $cur = $row && $row['parent_id'] !== null ? (int) $row['parent_id'] : null;
            }
            $sets[] = 'parent_id = ?'; $params[] = $newParent;
        }
        if ($sets) {
            $params[] = $l['id'];
            Database::exec('UPDATE storage_locations SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
        }
        return self::one($l['public_id'], $uid);
    }

    public static function destroy(Request $r): array
    {
        $uid = (int) Security::userId();
        $l = self::find($r->params['id'], $uid);
        if ($l['is_system']) { throw new HttpException(403, 'FORBIDDEN', 'Locais do sistema não podem ser excluídos.'); }
        if ($l['binder_id'] !== null) { throw new HttpException(403, 'FORBIDDEN', 'Este local pertence a um fichário físico.'); }
        if ($l['deck_id'] !== null) { throw new HttpException(403, 'FORBIDDEN', 'Este local pertence a um deck montado. Desmonte o deck primeiro.'); }
        if (Database::one('SELECT id FROM storage_locations WHERE parent_id = ? LIMIT 1', [$l['id']])) { throw HttpException::rule('NOT_EMPTY', 'Mova ou exclua os sublocais antes.'); }
        $n = (int) Database::one("SELECT COUNT(*) n FROM card_copies WHERE location_id = ? AND status = 'active'", [$l['id']])['n'];
        if ($n) { throw HttpException::rule('NOT_EMPTY', "Há $n carta(s) neste local. Mova-as antes de excluir."); }
        Database::exec('DELETE FROM storage_locations WHERE id = ?', [$l['id']]);
        Repo::activity($uid, 'location', "Local “{$l['name']}” excluído", 'trash');
        return ['ok' => true];
    }

    public static function batches(Request $r): array
    {
        return InventoryRepo::batches((int) Security::userId());
    }

    private static function one(string $pub, int $uid): array
    {
        foreach (self::index(new Request('GET', '/', [], '', [], '')) as $l) {
            if ($l['id'] === $pub) { return $l; }
        }
        throw HttpException::notFound();
    }
}
