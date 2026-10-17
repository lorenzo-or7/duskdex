<?php
declare(strict_types=1);

namespace DuskDex\Modules\Wishlist;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Shared\Repo;

/** Wishlist: cartas desejadas (nunca contam como possuídas). */
final class WishlistController
{
    private static function out(array $w): array
    {
        return ['id' => $w['public_id'], 'cardKey' => $w['card_key'], 'cardId' => $w['card_id'], 'qty' => (int) $w['qty'], 'priority' => $w['priority'], 'note' => $w['note'], 'createdAt' => Repo::iso($w['created_at']), 'updatedAt' => Repo::iso($w['updated_at'])];
    }

    public static function index(Request $r): array
    {
        return array_map([self::class, 'out'], Database::all('SELECT * FROM wishlist_items WHERE owner_id = ? ORDER BY id DESC', [Security::userId()]));
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $v = new Validator($r->json());
        $key = $v->str('cardKey', 3, 120, true, '/^([a-z]{2}(?:-[a-z]{2})?:[A-Za-z0-9._-]{1,60}|custom:custom_[a-z0-9]{6,40})$/', 'Carta');
        $cardId = $v->str('cardId', 1, 80, true, '/^[A-Za-z0-9._-]+$/', 'Id da carta');
        $qty = $v->int('qty', 1, 99, false, 1);
        $prio = $v->in('priority', ['alta', 'normal', 'baixa'], false, 'normal');
        $note = (string) $v->str('note', 0, 140, false);
        $v->check();
        $now = Repo::now();
        Database::exec('INSERT INTO wishlist_items (public_id, owner_id, card_key, card_id, qty, priority, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE qty = GREATEST(qty, VALUES(qty)), updated_at = VALUES(updated_at)',
            [Ulid::generate(), $uid, $key, $cardId, $qty, $prio, $note, $now, $now]);
        Database::exec('INSERT IGNORE INTO user_cards (owner_id, card_key, created_at) VALUES (?, ?, ?)', [$uid, $key, $now]);
        return self::out(Database::one('SELECT * FROM wishlist_items WHERE owner_id = ? AND card_id = ?', [$uid, $cardId]));
    }

    public static function update(Request $r): array
    {
        $uid = (int) Security::userId();
        $w = Database::one('SELECT * FROM wishlist_items WHERE public_id = ? AND owner_id = ?', [$r->params['id'], $uid]);
        if (!$w) { throw HttpException::notFound(); }
        $in = $r->json();
        $v = new Validator($in);
        $qty = array_key_exists('qty', $in) ? $v->int('qty', 1, 99) : (int) $w['qty'];
        $prio = array_key_exists('priority', $in) ? $v->in('priority', ['alta', 'normal', 'baixa']) : $w['priority'];
        $note = array_key_exists('note', $in) ? (string) $v->str('note', 0, 140, false) : $w['note'];
        $v->check();
        Database::exec('UPDATE wishlist_items SET qty = ?, priority = ?, note = ?, updated_at = ? WHERE id = ?', [$qty, $prio, $note, Repo::now(), $w['id']]);
        return self::out(Database::one('SELECT * FROM wishlist_items WHERE id = ?', [$w['id']]));
    }

    public static function destroy(Request $r): array
    {
        $n = Database::exec('DELETE FROM wishlist_items WHERE public_id = ? AND owner_id = ?', [$r->params['id'], Security::userId()]);
        if (!$n) { throw HttpException::notFound(); }
        return ['ok' => true];
    }
}
