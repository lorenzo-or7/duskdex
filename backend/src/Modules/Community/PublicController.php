<?php
declare(strict_types=1);

namespace DuskDex\Modules\Community;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Modules\Binders\BinderService;
use DuskDex\Modules\Shared\Repo;

/**
 * Páginas públicas: perfil de colecionador, fichários e decks públicos/não listados, seguidores, busca.
 * Nunca expõe e-mail, localização física das cartas, inventário, histórico ou ids de cópias.
 */
final class PublicController
{
    private static function privacy(array $u): array
    {
        $p = Repo::decode($u['privacy'] ?? null, []);
        return ['showStats' => ($p['showStats'] ?? true) !== false, 'showBinders' => ($p['showBinders'] ?? true) !== false,
            'showDecks' => ($p['showDecks'] ?? true) !== false, 'showTrades' => ($p['showTrades'] ?? true) !== false];
    }

    /** Fichário sem dados de inventário: bolsos de cópia viram apenas a carta (sem copyId). */
    private static function publicPages(array $pages): array
    {
        return array_map(fn ($p) => ['id' => $p['id'], 'rows' => $p['rows'], 'cols' => $p['cols'], 'slots' => array_map(function ($s) {
            unset($s['copyId']);
            return $s;
        }, $p['slots'])], $pages);
    }

    public static function binderBrief(array $b): array
    {
        $pages = Repo::decode($b['pages']);
        $slots = 0; $filled = 0; $keys = [];
        foreach ($pages as $p) {
            foreach ($p['slots'] as $s) {
                $slots++;
                if (in_array($s['kind'], ['copy', 'virtual', 'image'], true)) { $filled++; }
                if (isset($s['cardKey']) && count($keys) < 1) { $keys[] = $s['cardKey']; }
            }
        }
        $app = Repo::decode($b['appearance'], []);
        $coverKey = $app['coverCardKey'] ?? ($keys[0] ?? null);
        $snaps = $coverKey ? Social::snapshots([$coverKey], (int) $b['owner_id']) : [];
        return ['id' => $b['public_id'], 'name' => $b['name'], 'description' => $b['description'], 'type' => $b['type'], 'visibility' => $b['visibility'],
            'appearance' => ['color' => $app['color'] ?? '#4b2f5e', 'style' => $app['style'] ?? 'classico', 'sheetColor' => $app['sheetColor'] ?? '#1a1420', 'coverCardKey' => $coverKey, 'coverAssetId' => $app['coverAssetId'] ?? null],
            'coverCard' => $coverKey ? ($snaps[$coverKey] ?? null) : null,
            'pages' => count($pages), 'slots' => $slots, 'filled' => $filled, 'progress' => $slots ? (int) round($filled / $slots * 100) : 0, 'updatedAt' => Repo::iso($b['updated_at'])];
    }

    public static function deckBrief(array $d): array
    {
        $cards = Repo::decode($d['cards']);
        $first = $d['cover_card_key'] ?: ($cards[0]['cardKey'] ?? null);
        $snaps = $first ? Social::snapshots([$first], (int) $d['owner_id']) : [];
        return ['id' => $d['public_id'], 'name' => $d['name'], 'format' => $d['format'], 'total' => array_sum(array_column($cards, 'qty')),
            'coverCard' => $first ? ($snaps[$first] ?? null) : null, 'updatedAt' => Repo::iso($d['updated_at'])];
    }

    public static function profile(Request $r): array
    {
        $viewer = Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        $uid = (int) $u['id'];
        $isMe = $viewer === $uid;
        if (!$isMe && $viewer !== null && Database::one('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [$uid, $viewer])) {
            throw HttpException::notFound('Colecionador não encontrado.');
        }
        $priv = self::privacy($u);
        $assets = Database::one('SELECT a.public_id AS avatar, b.public_id AS banner FROM users u LEFT JOIN assets a ON a.id = u.avatar_asset_id LEFT JOIN assets b ON b.id = u.banner_asset_id WHERE u.id = ?', [$uid]);
        $out = [
            'id' => $u['public_id'], 'username' => $u['username'], 'displayName' => $u['display_name'], 'bio' => $u['bio'],
            'avatarUrl' => Social::assetUrl($assets['avatar']), 'bannerUrl' => Social::assetUrl($assets['banner']), 'joinedAt' => Repo::iso($u['created_at']),
            'followers' => (int) Database::one('SELECT COUNT(*) n FROM follows WHERE followee_id = ?', [$uid])['n'],
            'following' => (int) Database::one('SELECT COUNT(*) n FROM follows WHERE follower_id = ?', [$uid])['n'],
            'isMe' => $isMe, 'privacy' => $isMe ? $priv : null,
            'isFollowing' => $viewer !== null && !$isMe && (bool) Database::one('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', [$viewer, $uid]),
            'followsYou' => $viewer !== null && !$isMe && (bool) Database::one('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', [$uid, $viewer]),
            'blocked' => $viewer !== null && !$isMe && (bool) Database::one('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [$viewer, $uid]),
            'stats' => null, 'binders' => null, 'decks' => null, 'tradable' => null,
        ];
        if ($priv['showStats']) {
            $s = Database::one("SELECT COUNT(*) cards, COUNT(DISTINCT card_id) prints FROM card_copies WHERE owner_id = ? AND status = 'active'", [$uid]);
            $out['stats'] = ['cards' => (int) $s['cards'], 'prints' => (int) $s['prints'],
                'binders' => (int) Database::one('SELECT COUNT(*) n FROM binders WHERE owner_id = ?', [$uid])['n'],
                'decks' => (int) Database::one('SELECT COUNT(*) n FROM decks WHERE owner_id = ?', [$uid])['n']];
        }
        if ($priv['showBinders']) {
            $out['binders'] = array_map([self::class, 'binderBrief'], Database::all("SELECT * FROM binders WHERE owner_id = ? AND visibility = 'public' ORDER BY favorite DESC, updated_at DESC LIMIT 24", [$uid]));
        }
        if ($priv['showDecks']) {
            $out['decks'] = array_map([self::class, 'deckBrief'], Database::all("SELECT * FROM decks WHERE owner_id = ? AND visibility = 'public' ORDER BY updated_at DESC LIMIT 24", [$uid]));
        }
        if ($priv['showTrades']) {
            $out['tradable'] = (int) Database::one("SELECT COUNT(*) n FROM card_copies WHERE owner_id = ? AND status = 'active' AND for_trade = 1", [$uid])['n'];
        }
        return $out;
    }

    public static function binder(Request $r): array
    {
        $viewer = Security::userId();
        $b = Database::one('SELECT * FROM binders WHERE public_id = ?', [$r->params['id']]);
        $isOwner = $b && $viewer === (int) $b['owner_id'];
        if (!$b || (!$isOwner && $b['visibility'] === 'private') || Social::blockedBetween($viewer, (int) $b['owner_id'])) {
            throw HttpException::notFound('Fichário não encontrado ou privado.');
        }
        $owner = Database::one("SELECT id FROM users WHERE id = ? AND status = 'active'", [$b['owner_id']]);
        if (!$owner) { throw HttpException::notFound('Fichário não encontrado ou privado.'); }
        $out = BinderService::out($b);
        $out['pages'] = self::publicPages($out['pages']);
        unset($out['locationId'], $out['favorite'], $out['version']);
        $keys = []; $assetIds = [];
        foreach ($out['pages'] as $p) { foreach ($p['slots'] as $s) { if (isset($s['cardKey'])) { $keys[] = $s['cardKey']; } if (isset($s['assetId'])) { $assetIds[] = $s['assetId']; } } }
        if (!empty($out['appearance']['coverAssetId'])) { $assetIds[] = $out['appearance']['coverAssetId']; }
        $assetIds = array_values(array_unique($assetIds));
        $out['assets'] = $assetIds ? array_map(fn ($a) => ['id' => $a['public_id'], 'width' => (int) $a['width'], 'height' => (int) $a['height'], 'url' => Social::assetUrl($a['public_id'])],
            Database::all('SELECT public_id, width, height FROM assets WHERE owner_id = ? AND public_id IN (' . implode(',', array_fill(0, count($assetIds), '?')) . ')', array_merge([(int) $b['owner_id']], $assetIds))) : [];
        if (!empty($out['appearance']['coverCardKey'])) { $keys[] = $out['appearance']['coverCardKey']; }
        $out['owner'] = Social::briefs([(int) $b['owner_id']])[(int) $b['owner_id']];
        $out['cards'] = array_values(Social::snapshots($keys, (int) $b['owner_id']));
        $out['isOwner'] = $isOwner;
        return $out;
    }

    public static function deck(Request $r): array
    {
        $viewer = Security::userId();
        $d = Database::one('SELECT * FROM decks WHERE public_id = ?', [$r->params['id']]);
        $isOwner = $d && $viewer === (int) $d['owner_id'];
        if (!$d || (!$isOwner && $d['visibility'] === 'private') || Social::blockedBetween($viewer, (int) $d['owner_id'])) {
            throw HttpException::notFound('Deck não encontrado ou privado.');
        }
        if (!Database::one("SELECT id FROM users WHERE id = ? AND status = 'active'", [$d['owner_id']])) {
            throw HttpException::notFound('Deck não encontrado ou privado.');
        }
        $cards = Repo::decode($d['cards']);
        return ['id' => $d['public_id'], 'name' => $d['name'], 'description' => $d['description'], 'format' => $d['format'], 'cards' => $cards,
            'owner' => Social::briefs([(int) $d['owner_id']])[(int) $d['owner_id']], 'isOwner' => $isOwner, 'updatedAt' => Repo::iso($d['updated_at']),
            'snapshots' => array_values(Social::snapshots(array_column($cards, 'cardKey'), (int) $d['owner_id']))];
    }

    public static function search(Request $r): array
    {
        $viewer = Security::userId();
        $q = trim((string) ($r->query['q'] ?? ''));
        $hidden = Social::hiddenFor($viewer);
        $params = [];
        $where = "u.status = 'active'";
        if ($viewer !== null) { $where .= ' AND u.id <> ?'; $params[] = $viewer; }
        if ($hidden) { $where .= ' AND u.id NOT IN (' . implode(',', array_fill(0, count($hidden), '?')) . ')'; array_push($params, ...$hidden); }
        if ($q !== '') {
            $like = '%' . addcslashes(mb_strtolower(mb_substr($q, 0, 40)), '%_\\') . '%';
            $where .= ' AND (u.username LIKE ? OR LOWER(u.display_name) LIKE ?)';
            array_push($params, $like, $like);
        }
        $rows = Database::all("SELECT u.id, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
            (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS posts
            FROM users u WHERE $where ORDER BY followers DESC, posts DESC, u.id DESC LIMIT 20", $params);
        $briefs = Social::briefs(array_column($rows, 'id'));
        $following = [];
        if ($viewer !== null && $rows) {
            $ids = array_column($rows, 'id');
            foreach (Database::all('SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', array_merge([$viewer], $ids)) as $f) {
                $following[(int) $f['followee_id']] = true;
            }
        }
        return array_map(fn ($u) => $briefs[(int) $u['id']] + ['followers' => (int) $u['followers'], 'posts' => (int) $u['posts'], 'isFollowing' => isset($following[(int) $u['id']])], $rows);
    }

    public static function follow(Request $r): array
    {
        $uid = (int) Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        $target = (int) $u['id'];
        if ($target === $uid) { throw HttpException::validation('Você não pode seguir a si mesmo.'); }
        if ($r->method === 'DELETE') {
            Database::exec('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [$uid, $target]);
            return ['following' => false];
        }
        if (Social::blockedBetween($uid, $target)) { throw new HttpException(403, 'BLOCKED', 'Não é possível seguir este colecionador.'); }
        Security::rateLimit('follow:' . $uid, 200, 3600);
        if (Database::exec('INSERT IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', [$uid, $target, Repo::now()])) {
            $me = Social::briefs([$uid])[$uid];
            Social::notify($target, $uid, 'follow', "@{$me['username']} começou a seguir você", 'user', $me['id']);
        }
        return ['following' => true];
    }

    public static function block(Request $r): array
    {
        $uid = (int) Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        $target = (int) $u['id'];
        if ($target === $uid) { throw HttpException::validation('Operação inválida.'); }
        if ($r->method === 'DELETE') {
            Database::exec('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [$uid, $target]);
            return ['blocked' => false];
        }
        Database::transaction(function () use ($uid, $target) {
            Database::exec('INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', [$uid, $target, Repo::now()]);
            // bloquear desfaz o "seguir" nos dois sentidos e cancela trocas pendentes entre os dois
            Database::exec('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', [$uid, $target, $target, $uid]);
            Database::exec("UPDATE trades SET status = 'cancelled', response = 'Cancelada por bloqueio entre os colecionadores.', updated_at = ? WHERE status = 'pending' AND ((proposer_id = ? AND recipient_id = ?) OR (proposer_id = ? AND recipient_id = ?))", [Repo::now(), $uid, $target, $target, $uid]);
        });
        return ['blocked' => true];
    }

    public static function connections(Request $r): array
    {
        $viewer = Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        $which = ($r->query['type'] ?? 'followers') === 'following' ? 'following' : 'followers';
        $rows = $which === 'followers'
            ? Database::all('SELECT follower_id AS id FROM follows WHERE followee_id = ? ORDER BY created_at DESC LIMIT 200', [$u['id']])
            : Database::all('SELECT followee_id AS id FROM follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT 200', [$u['id']]);
        $hidden = array_flip(Social::hiddenFor($viewer));
        $ids = array_values(array_filter(array_map(fn ($r) => (int) $r['id'], $rows), fn ($id) => !isset($hidden[$id])));
        $briefs = Social::briefs($ids);
        return array_values(array_filter(array_map(fn ($id) => $briefs[$id] ?? null, $ids)));
    }
}
