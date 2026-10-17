<?php
declare(strict_types=1);

namespace DuskDex\Modules\Community;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Modules\Shared\Repo;

/** Notificações (curtidas, comentários, seguidores, trocas) e moderação de denúncias (administradores). */
final class NotificationController
{
    public static function index(Request $r): array
    {
        $uid = (int) Security::userId();
        $rows = Database::all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', [$uid]);
        $actors = Social::briefs(array_column($rows, 'actor_id'));
        return array_map(fn ($n) => [
            'id' => (int) $n['id'], 'type' => $n['type'], 'text' => $n['text'], 'actor' => $n['actor_id'] !== null ? ($actors[(int) $n['actor_id']] ?? null) : null,
            'ref' => $n['ref_type'] ? ['type' => $n['ref_type'], 'id' => $n['ref_public']] : null, 'read' => $n['read_at'] !== null, 'createdAt' => Repo::iso($n['created_at']),
        ], $rows);
    }

    public static function count(Request $r): array
    {
        $uid = (int) Security::userId();
        return [
            'unread' => (int) Database::one('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', [$uid])['n'],
            'trades' => (int) Database::one("SELECT COUNT(*) n FROM trades WHERE recipient_id = ? AND status = 'pending'", [$uid])['n'],
        ];
    }

    public static function markRead(Request $r): array
    {
        $uid = (int) Security::userId();
        $ids = array_values(array_filter((array) $r->input('ids', []), 'is_int'));
        if ($ids) {
            Database::exec('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', array_merge([Repo::now(), $uid], $ids));
        } else {
            Database::exec('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [Repo::now(), $uid]);
        }
        return self::count($r);
    }

    // ------------------------------------------------------------ moderação (role = admin)

    private static function admin(): int
    {
        if (!Security::isAdmin()) { throw new HttpException(403, 'FORBIDDEN', 'Área restrita à moderação.'); }
        return (int) Security::userId();
    }

    public static function reports(Request $r): array
    {
        self::admin();
        $status = in_array($r->query['status'] ?? 'open', ['open', 'dismissed', 'actioned'], true) ? ($r->query['status'] ?? 'open') : 'open';
        $rows = Database::all('SELECT r.*, (SELECT COUNT(*) FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id) AS total FROM reports r WHERE r.status = ? ORDER BY r.id DESC LIMIT 100', [$status]);
        $reporters = Social::briefs(array_column($rows, 'reporter_id'));
        return array_map(function ($x) use ($reporters) {
            $target = match ($x['target_type']) {
                'post' => ($p = Database::one('SELECT public_id, body, author_id, hidden_at, deleted_at FROM posts WHERE id = ?', [$x['target_id']])) ? ['id' => $p['public_id'], 'text' => $p['body'], 'author' => Social::briefs([(int) $p['author_id']])[(int) $p['author_id']] ?? null, 'hidden' => $p['hidden_at'] !== null || $p['deleted_at'] !== null] : null,
                'comment' => ($c = Database::one('SELECT public_id, body, author_id, hidden_at, deleted_at FROM post_comments WHERE id = ?', [$x['target_id']])) ? ['id' => $c['public_id'], 'text' => $c['body'], 'author' => Social::briefs([(int) $c['author_id']])[(int) $c['author_id']] ?? null, 'hidden' => $c['hidden_at'] !== null || $c['deleted_at'] !== null] : null,
                default => ($u = Database::one('SELECT id, status FROM users WHERE id = ?', [$x['target_id']])) ? ['author' => Social::briefs([(int) $u['id']])[(int) $u['id']] ?? null, 'hidden' => $u['status'] !== 'active'] : null,
            };
            return ['id' => $x['public_id'], 'targetType' => $x['target_type'], 'target' => $target, 'reason' => $x['reason'], 'details' => $x['details'],
                'reporter' => $reporters[(int) $x['reporter_id']] ?? null, 'reports' => (int) $x['total'], 'status' => $x['status'], 'createdAt' => Repo::iso($x['created_at'])];
        }, $rows);
    }

    /** action: dismiss (arquiva) | hide (oculta post/comentário ou suspende a conta denunciada). */
    public static function resolve(Request $r): array
    {
        $admin = self::admin();
        $rep = Database::one('SELECT * FROM reports WHERE public_id = ?', [$r->params['id']]);
        if (!$rep) { throw HttpException::notFound(); }
        $action = $r->input('action');
        if (!in_array($action, ['dismiss', 'hide'], true)) { throw HttpException::validation('Ação inválida.'); }
        Database::transaction(function () use ($rep, $action, $admin) {
            if ($action === 'hide') {
                match ($rep['target_type']) {
                    'post' => Database::exec('UPDATE posts SET hidden_at = ? WHERE id = ?', [Repo::now(), $rep['target_id']]),
                    'comment' => Database::exec('UPDATE post_comments SET hidden_at = ? WHERE id = ?', [Repo::now(), $rep['target_id']]),
                    default => Database::exec("UPDATE users SET status = 'suspended' WHERE id = ? AND role <> 'admin'", [$rep['target_id']]),
                };
            }
            // todas as denúncias do mesmo alvo são resolvidas juntas
            Database::exec('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE target_type = ? AND target_id = ? AND status = \'open\'',
                [$action === 'hide' ? 'actioned' : 'dismissed', Repo::now(), $admin, $rep['target_type'], $rep['target_id']]);
        });
        return ['ok' => true];
    }
}
