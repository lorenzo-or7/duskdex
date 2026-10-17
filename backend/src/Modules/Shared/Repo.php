<?php
declare(strict_types=1);

namespace DuskDex\Modules\Shared;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;

/** Utilidades de persistência compartilhadas (datas, IDs públicos ↔ internos com checagem de dono, atividade). */
final class Repo
{
    private const TABLES = ['storage_locations', 'binders', 'decks', 'card_copies', 'wishlist_items', 'inventory_batches', 'inventory_movements', 'assets', 'posts', 'post_comments', 'trades', 'reports'];
    private static array $pubCache = [];

    public static function now(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
    }

    public static function iso(?string $db): ?string
    {
        if ($db === null) {
            return null;
        }
        return (new \DateTimeImmutable($db, new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** Converte ID público → interno garantindo que pertence ao usuário. Recurso de outro usuário = 404 (não revela existência). */
    public static function id(string $table, mixed $publicId, int $ownerId, bool $forUpdate = false): int
    {
        if (!in_array($table, self::TABLES, true) || !is_string($publicId) || $publicId === '') {
            throw HttpException::notFound();
        }
        $row = Database::one("SELECT id FROM `$table` WHERE public_id = ? AND owner_id = ?" . ($forUpdate ? ' FOR UPDATE' : ''), [$publicId, $ownerId]);
        if (!$row) {
            throw HttpException::notFound();
        }
        return (int) $row['id'];
    }

    public static function pub(string $table, ?int $id): ?string
    {
        if ($id === null) {
            return null;
        }
        $k = "$table:$id";
        if (!isset(self::$pubCache[$k])) {
            if (!in_array($table, self::TABLES, true)) {
                return null;
            }
            self::$pubCache[$k] = Database::one("SELECT public_id FROM `$table` WHERE id = ?", [$id])['public_id'] ?? null;
        }
        return self::$pubCache[$k];
    }

    public static function remember(string $table, int $id, string $pub): void { self::$pubCache["$table:$id"] = $pub; }

    public static function activity(int $ownerId, string $type, string $text, string $icon = 'info'): void
    {
        Database::exec('INSERT INTO activity (owner_id, type, text, icon, created_at) VALUES (?, ?, ?, ?, ?)', [$ownerId, $type, mb_substr($text, 0, 255), $icon, self::now()]);
    }

    public static function systemLocation(int $ownerId, string $which): int
    {
        $row = Database::one('SELECT id FROM storage_locations WHERE owner_id = ? AND is_system = 1 AND is_hidden = ?', [$ownerId, $which === 'removed' ? 1 : 0]);
        if (!$row) {
            throw new \RuntimeException('Locais do sistema ausentes para o usuário.');
        }
        return (int) $row['id'];
    }

    public static function json(mixed $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function decode(?string $v, mixed $default = []): mixed
    {
        if ($v === null || $v === '') {
            return $default;
        }
        return json_decode($v, true) ?? $default;
    }
}
