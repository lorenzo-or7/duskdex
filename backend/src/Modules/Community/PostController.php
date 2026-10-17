<?php
declare(strict_types=1);

namespace DuskDex\Modules\Community;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Kernel\Ulid;
use DuskDex\Modules\Shared\Repo;

/**
 * Publicações da comunidade: feed (todos / quem você segue), publicar com cartas, fichário ou deck anexado,
 * curtidas, comentários, exclusão (autor ou moderação) e denúncias.
 * Leitura do feed geral é pública; escrever exige conta.
 */
final class PostController
{
    private const PAGE = 20;

    private static function requireVerified(int $uid): void
    {
        if (!Env::bool('REQUIRE_VERIFIED_EMAIL')) { return; }
        if (!Database::one('SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL', [$uid])) {
            throw HttpException::rule('EMAIL_NOT_VERIFIED', 'Confirme seu e-mail para participar da comunidade.');
        }
    }

    /** Monta a saída de vários posts de uma vez (autores, anexos, curtidas do visitante). */
    public static function present(array $rows, ?int $viewer): array
    {
        if (!$rows) { return []; }
        $authors = Social::briefs(array_column($rows, 'author_id'));
        $liked = [];
        if ($viewer !== null) {
            $ids = array_column($rows, 'id');
            $in = implode(',', array_fill(0, count($ids), '?'));
            foreach (Database::all("SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN ($in)", array_merge([$viewer], $ids)) as $l) { $liked[(int) $l['post_id']] = true; }
        }
        $isAdmin = Security::isAdmin();
        $out = [];
        foreach ($rows as $p) {
            $att = Repo::decode($p['attachment'], null);
            $attachment = null;
            if ($p['attachment_type'] === 'cards' && $att) {
                $snaps = Social::snapshots($att['cards'] ?? [], (int) $p['author_id']);
                $attachment = ['type' => 'cards', 'cards' => array_values(array_filter(array_map(fn ($k) => $snaps[$k] ?? null, $att['cards'] ?? [])))];
            } elseif ($p['attachment_type'] === 'binder' && $att) {
                $b = Database::one("SELECT * FROM binders WHERE public_id = ? AND owner_id = ? AND visibility IN ('public', 'unlisted')", [$att['id'] ?? '', $p['author_id']]);
                $attachment = $b ? ['type' => 'binder', 'binder' => PublicController::binderBrief($b)] : ['type' => 'binder', 'binder' => null, 'note' => 'Este fichário não está mais público.'];
            } elseif ($p['attachment_type'] === 'deck' && $att) {
                $d = Database::one("SELECT * FROM decks WHERE public_id = ? AND owner_id = ? AND visibility IN ('public', 'unlisted')", [$att['id'] ?? '', $p['author_id']]);
                $attachment = $d ? ['type' => 'deck', 'deck' => PublicController::deckBrief($d)] : ['type' => 'deck', 'deck' => null, 'note' => 'Este deck não está mais público.'];
            }
            $out[] = [
                'id' => $p['public_id'], 'author' => $authors[(int) $p['author_id']] ?? null, 'body' => $p['body'], 'attachment' => $attachment,
                'likes' => (int) $p['like_count'], 'comments' => (int) $p['comment_count'], 'liked' => isset($liked[(int) $p['id']]),
                'createdAt' => Repo::iso($p['created_at']), 'mine' => $viewer !== null && $viewer === (int) $p['author_id'],
                'canDelete' => $viewer !== null && ($viewer === (int) $p['author_id'] || $isAdmin),
            ];
        }
        return $out;
    }

    /** Filtro comum: post visível, autor ativo, sem bloqueio entre autor e visitante. */
    private static function visibleSql(?int $viewer, array &$params): string
    {
        $sql = "p.deleted_at IS NULL AND p.hidden_at IS NULL AND u.status = 'active'";
        $hidden = Social::hiddenFor($viewer);
        if ($hidden) {
            $sql .= ' AND p.author_id NOT IN (' . implode(',', array_fill(0, count($hidden), '?')) . ')';
            array_push($params, ...$hidden);
        }
        return $sql;
    }

    public static function feed(Request $r): array
    {
        $viewer = Security::userId();
        $scope = ($r->query['scope'] ?? 'all') === 'following' ? 'following' : 'all';
        if ($scope === 'following' && $viewer === null) { throw HttpException::unauthenticated(); }
        $params = [];
        $where = self::visibleSql($viewer, $params);
        if ($scope === 'following') {
            $where .= ' AND (p.author_id = ? OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))';
            array_push($params, $viewer, $viewer);
        }
        $before = $r->query['before'] ?? null;
        if (is_string($before) && $before !== '') {
            $bid = Database::one('SELECT id FROM posts WHERE public_id = ?', [$before]);
            if ($bid) { $where .= ' AND p.id < ?'; $params[] = (int) $bid['id']; }
        }
        $rows = Database::all('SELECT p.* FROM posts p JOIN users u ON u.id = p.author_id WHERE ' . $where . ' ORDER BY p.id DESC LIMIT ' . (self::PAGE + 1), $params);
        $more = count($rows) > self::PAGE;
        return ['items' => self::present(array_slice($rows, 0, self::PAGE), $viewer), 'more' => $more];
    }

    public static function byUser(Request $r): array
    {
        $viewer = Security::userId();
        $u = Social::userByUsername((string) $r->params['username']);
        if (Social::blockedBetween($viewer, (int) $u['id'])) { return ['items' => [], 'more' => false]; }
        $params = [(int) $u['id']];
        $where = 'p.author_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL';
        $before = $r->query['before'] ?? null;
        if (is_string($before) && $before !== '' && ($bid = Database::one('SELECT id FROM posts WHERE public_id = ?', [$before]))) { $where .= ' AND p.id < ?'; $params[] = (int) $bid['id']; }
        $rows = Database::all("SELECT p.* FROM posts p WHERE $where ORDER BY p.id DESC LIMIT " . (self::PAGE + 1), $params);
        return ['items' => self::present(array_slice($rows, 0, self::PAGE), $viewer), 'more' => count($rows) > self::PAGE];
    }

    public static function show(Request $r): array
    {
        $viewer = Security::userId();
        $p = self::find((string) $r->params['id'], $viewer);
        return self::present([$p], $viewer)[0];
    }

    private static function find(string $pub, ?int $viewer, bool $lock = false): array
    {
        $p = Database::one("SELECT p.* FROM posts p JOIN users u ON u.id = p.author_id WHERE p.public_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND u.status = 'active'" . ($lock ? ' FOR UPDATE' : ''), [$pub]);
        if (!$p || Social::blockedBetween($viewer, (int) $p['author_id'])) { throw HttpException::notFound('Publicação não encontrada.'); }
        return $p;
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        self::requireVerified($uid);
        Security::rateLimit('post:' . $uid, Env::int('RATE_POSTS_PER_HOUR', 20), 3600);
        $body = Social::text($r->input('body'), 1, 1000, 'O texto');
        $type = 'none'; $att = null;
        $a = $r->input('attachment');
        if (is_array($a) && ($a['type'] ?? '') !== '') {
            switch ($a['type']) {
                case 'cards':
                    $keys = array_values(array_unique(array_filter((array) ($a['cards'] ?? []), 'is_string')));
                    if (!$keys || count($keys) > 6) { throw HttpException::validation('Anexe de 1 a 6 cartas.'); }
                    foreach ($keys as $k) {
                        if (!Database::one('SELECT 1 FROM user_cards WHERE owner_id = ? AND card_key = ?', [$uid, $k])) { throw HttpException::validation('Carta anexada desconhecida.'); }
                    }
                    $type = 'cards'; $att = ['cards' => $keys];
                    break;
                case 'binder':
                    $b = Database::one('SELECT public_id, visibility FROM binders WHERE public_id = ? AND owner_id = ?', [$a['id'] ?? '', $uid]);
                    if (!$b) { throw HttpException::validation('Fichário não encontrado.'); }
                    if ($b['visibility'] === 'private') { throw HttpException::rule('PRIVATE', 'Torne o fichário público ou não listado antes de compartilhar.'); }
                    $type = 'binder'; $att = ['id' => $b['public_id']];
                    break;
                case 'deck':
                    $d = Database::one('SELECT public_id, visibility FROM decks WHERE public_id = ? AND owner_id = ?', [$a['id'] ?? '', $uid]);
                    if (!$d) { throw HttpException::validation('Deck não encontrado.'); }
                    if ($d['visibility'] === 'private') { throw HttpException::rule('PRIVATE', 'Torne o deck público ou não listado antes de compartilhar.'); }
                    $type = 'deck'; $att = ['id' => $d['public_id']];
                    break;
                default:
                    throw HttpException::validation('Anexo inválido.');
            }
        }
        $now = Repo::now();
        $pub = Ulid::generate();
        $id = Database::insert('INSERT INTO posts (public_id, author_id, body, attachment_type, attachment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$pub, $uid, $body, $type, $att ? Repo::json($att) : null, $now, $now]);
        return self::present([Database::one('SELECT * FROM posts WHERE id = ?', [$id])], $uid)[0];
    }

    public static function destroy(Request $r): array
    {
        $uid = (int) Security::userId();
        $p = Database::one('SELECT * FROM posts WHERE public_id = ? AND deleted_at IS NULL', [$r->params['id']]);
        if (!$p) { throw HttpException::notFound('Publicação não encontrada.'); }
        if ((int) $p['author_id'] !== $uid && !Security::isAdmin()) { throw new HttpException(403, 'FORBIDDEN', 'Você só pode excluir as suas publicações.'); }
        Database::exec('UPDATE posts SET deleted_at = ? WHERE id = ?', [Repo::now(), $p['id']]);
        return ['ok' => true];
    }

    public static function like(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('like:' . $uid, 600, 3600);
        $on = $r->method !== 'DELETE';
        return Database::transaction(function () use ($uid, $on, $r) {
            $p = self::find((string) $r->params['id'], $uid, true);
            if ($on) {
                $n = Database::exec('INSERT IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)', [$p['id'], $uid, Repo::now()]);
                if ($n) {
                    Database::exec('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', [$p['id']]);
                    $me = Social::briefs([$uid])[$uid];
                    Social::notify((int) $p['author_id'], $uid, 'like', "@{$me['username']} curtiu sua publicação", 'post', $p['public_id']);
                }
            } elseif (Database::exec('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [$p['id'], $uid])) {
                Database::exec('UPDATE posts SET like_count = GREATEST(like_count, 1) - 1 WHERE id = ?', [$p['id']]);
            }
            $cur = Database::one('SELECT like_count FROM posts WHERE id = ?', [$p['id']]);
            return ['liked' => $on, 'likes' => (int) $cur['like_count']];
        });
    }

    public static function comments(Request $r): array
    {
        $viewer = Security::userId();
        $p = self::find((string) $r->params['id'], $viewer);
        $hidden = Social::hiddenFor($viewer);
        $params = [$p['id']];
        $extra = '';
        if ($hidden) { $extra = ' AND c.author_id NOT IN (' . implode(',', array_fill(0, count($hidden), '?')) . ')'; array_push($params, ...$hidden); }
        $rows = Database::all("SELECT c.* FROM post_comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = ? AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND u.status = 'active'$extra ORDER BY c.id LIMIT 200", $params);
        $authors = Social::briefs(array_column($rows, 'author_id'));
        $isAdmin = Security::isAdmin();
        return array_map(fn ($c) => [
            'id' => $c['public_id'], 'author' => $authors[(int) $c['author_id']] ?? null, 'body' => $c['body'], 'createdAt' => Repo::iso($c['created_at']),
            'canDelete' => $viewer !== null && ($viewer === (int) $c['author_id'] || $viewer === (int) $p['author_id'] || $isAdmin),
        ], $rows);
    }

    public static function comment(Request $r): array
    {
        $uid = (int) Security::userId();
        self::requireVerified($uid);
        Security::rateLimit('comment:' . $uid, Env::int('RATE_COMMENTS_PER_HOUR', 60), 3600);
        $body = Social::text($r->input('body'), 1, 500, 'O comentário');
        return Database::transaction(function () use ($uid, $body, $r) {
            $p = self::find((string) $r->params['id'], $uid, true);
            $pub = Ulid::generate();
            Database::insert('INSERT INTO post_comments (public_id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [$pub, $p['id'], $uid, $body, Repo::now()]);
            Database::exec('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [$p['id']]);
            $me = Social::briefs([$uid])[$uid];
            Social::notify((int) $p['author_id'], $uid, 'comment', "@{$me['username']} comentou: " . mb_substr($body, 0, 80), 'post', $p['public_id']);
            return ['id' => $pub, 'author' => $me, 'body' => $body, 'createdAt' => Repo::iso(Repo::now()), 'canDelete' => true];
        });
    }

    public static function deleteComment(Request $r): array
    {
        $uid = (int) Security::userId();
        $c = Database::one('SELECT c.*, p.author_id AS post_author FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.public_id = ? AND c.deleted_at IS NULL', [$r->params['id']]);
        if (!$c) { throw HttpException::notFound('Comentário não encontrado.'); }
        if ($uid !== (int) $c['author_id'] && $uid !== (int) $c['post_author'] && !Security::isAdmin()) { throw new HttpException(403, 'FORBIDDEN', 'Sem permissão para excluir este comentário.'); }
        Database::transaction(function () use ($c) {
            Database::exec('UPDATE post_comments SET deleted_at = ? WHERE id = ?', [Repo::now(), $c['id']]);
            Database::exec('UPDATE posts SET comment_count = GREATEST(comment_count, 1) - 1 WHERE id = ?', [$c['post_id']]);
        });
        return ['ok' => true];
    }

    public const REPORT_REASONS = ['spam', 'ofensivo', 'golpe', 'conteudo_improprio', 'direitos', 'outro'];

    public static function report(Request $r): array
    {
        $uid = (int) Security::userId();
        Security::rateLimit('report:' . $uid, 20, 3600);
        $type = $r->input('targetType');
        $reason = $r->input('reason');
        if (!in_array($type, ['post', 'comment', 'user'], true) || !in_array($reason, self::REPORT_REASONS, true)) { throw HttpException::validation('Denúncia inválida.'); }
        $details = is_string($r->input('details')) ? mb_substr(trim((string) $r->input('details')), 0, 500) : '';
        $target = (string) $r->input('targetId');
        $row = match ($type) {
            'post' => Database::one('SELECT id FROM posts WHERE public_id = ?', [$target]),
            'comment' => Database::one('SELECT id FROM post_comments WHERE public_id = ?', [$target]),
            'user' => Database::one('SELECT id FROM users WHERE username = ?', [mb_strtolower($target)]),
        };
        if (!$row) { throw HttpException::notFound('Conteúdo não encontrado.'); }
        Database::exec('INSERT INTO reports (public_id, reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason), details = VALUES(details), status = \'open\'',
            [Ulid::generate(), $uid, $type, $row['id'], $reason, $details, Repo::now()]);
        return ['ok' => true, 'message' => 'Denúncia enviada. A moderação vai analisar.'];
    }
}
