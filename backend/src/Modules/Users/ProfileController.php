<?php
declare(strict_types=1);

namespace DuskDex\Modules\Users;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Validator;
use DuskDex\Modules\Shared\Repo;

/** Perfil privado, preferências de privacidade, atividade e exportação de dados (LGPD). */
final class ProfileController
{
    public const PRIVACY_KEYS = ['showStats', 'showBinders', 'showDecks', 'showTrades'];

    public static function show(Request $r): array
    {
        $u = Database::one('SELECT u.username, u.display_name, u.bio, u.privacy, u.email, u.email_verified_at, u.created_at, a.public_id AS avatar, b.public_id AS banner
            FROM users u LEFT JOIN assets a ON a.id = u.avatar_asset_id LEFT JOIN assets b ON b.id = u.banner_asset_id WHERE u.id = ?', [Security::userId()]);
        $url = fn ($pub) => $pub ? 'api/v1/assets/' . $pub . '/file' : null;
        return ['username' => $u['username'], 'displayName' => $u['display_name'], 'bio' => $u['bio'], 'email' => $u['email'],
            'emailVerified' => $u['email_verified_at'] !== null, 'privacy' => Repo::decode($u['privacy'], new \stdClass()),
            'avatarAssetId' => $u['avatar'], 'bannerAssetId' => $u['banner'], 'avatarUrl' => $url($u['avatar']), 'bannerUrl' => $url($u['banner']),
            'createdAt' => Repo::iso($u['created_at'])];
    }

    public static function update(Request $r): array
    {
        $in = $r->json();
        $v = new Validator($in);
        $sets = []; $params = [];
        if (array_key_exists('displayName', $in)) { $sets[] = 'display_name = ?'; $params[] = $v->str('displayName', 1, 60, true, null, 'Nome de exibição'); }
        if (array_key_exists('bio', $in)) { $sets[] = 'bio = ?'; $params[] = (string) $v->str('bio', 0, 280, false, null, 'Biografia'); }
        if (array_key_exists('privacy', $in)) {
            $p = is_array($in['privacy']) ? $in['privacy'] : [];
            $cur = Repo::decode(Database::one('SELECT privacy FROM users WHERE id = ?', [Security::userId()])['privacy'] ?? null);
            $clean = is_array($cur) ? $cur : [];
            foreach (self::PRIVACY_KEYS as $k) { if (array_key_exists($k, $p)) { $clean[$k] = (bool) $p[$k]; } }
            $sets[] = 'privacy = ?'; $params[] = Repo::json($clean);
        }
        foreach (['avatarAssetId' => 'avatar_asset_id', 'bannerAssetId' => 'banner_asset_id'] as $k => $col) {
            if (array_key_exists($k, $in)) {
                $sets[] = "$col = ?";
                $params[] = $in[$k] === null || $in[$k] === '' ? null : \DuskDex\Modules\Assets\AssetController::ownedId((int) Security::userId(), $in[$k]);
            }
        }
        $v->check();
        if ($sets) {
            $sets[] = 'updated_at = ?'; $params[] = Repo::now(); $params[] = Security::userId();
            Database::exec('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
        }
        return self::show($r);
    }

    public static function activity(Request $r): array
    {
        $limit = max(1, min(100, (int) ($r->query['limit'] ?? 30)));
        $rows = Database::all("SELECT id, type, text, icon, created_at FROM activity WHERE owner_id = ? ORDER BY id DESC LIMIT $limit", [Security::userId()]);
        return array_map(fn ($a) => ['id' => 'act_' . $a['id'], 'type' => $a['type'], 'text' => $a['text'], 'icon' => $a['icon'], 'at' => Repo::iso($a['created_at'])], $rows);
    }

    /** Exportação dos próprios dados (LGPD). Não inclui hash de senha nem eventos de segurança. */
    public static function export(Request $r): array
    {
        $uid = Security::userId();
        $q = fn (string $sql) => Database::all($sql, [$uid]);
        return [
            'format' => 'duskdex-server-export', 'exportedAt' => gmdate('c'),
            'profile' => self::show($r),
            'locations' => $q('SELECT public_id, name, kind, description, capacity, created_at FROM storage_locations WHERE owner_id = ?'),
            'copies' => $q('SELECT public_id, card_key, card_id, lang, finish, status, created_at FROM card_copies WHERE owner_id = ?'),
            'binders' => array_map(fn ($b) => ['id' => $b['public_id'], 'name' => $b['name'], 'type' => $b['type'], 'pages' => Repo::decode($b['pages'])], $q('SELECT public_id, name, type, pages FROM binders WHERE owner_id = ?')),
            'decks' => array_map(fn ($d) => ['id' => $d['public_id'], 'name' => $d['name'], 'cards' => Repo::decode($d['cards'])], $q('SELECT public_id, name, cards FROM decks WHERE owner_id = ?')),
            'wishlist' => $q('SELECT public_id, card_key, qty, priority, note FROM wishlist_items WHERE owner_id = ?'),
        ];
    }
}
