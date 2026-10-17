<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

use PDO;

/** Aplica as migrações SQL versionadas (backend/migrations/NNN_nome.sql) em ordem. Usado pelo migrate.php e pelo instalar.php. */
final class Migrator
{
    /**
     * Tabelas que já existem no banco com o mesmo nome das do DuskDex, mas que não foram criadas por ele
     * (banco compartilhado com outro site). Vazio = seguro instalar.
     * @return string[]
     */
    public static function conflicts(PDO $pdo): array
    {
        $existing = array_map('strtolower', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        if (in_array('schema_migrations', $existing, true)) {
            $mine = $pdo->query("SELECT COUNT(*) FROM schema_migrations WHERE version = '001_init'")->fetchColumn();
            if ($mine) {
                return []; // já é um banco do DuskDex (atualização)
            }
        }
        $ours = [];
        foreach (glob(dirname(__DIR__, 2) . '/migrations/*.sql') ?: [] as $file) {
            preg_match_all('/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)/i', (string) file_get_contents($file), $m);
            $ours = array_merge($ours, array_map('strtolower', $m[1]));
        }
        $ours[] = 'schema_migrations';
        return array_values(array_intersect($existing, array_unique($ours)));
    }

    /** @return string[] versões aplicadas agora */
    public static function run(PDO $pdo): array
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB');
        $done = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        $files = glob(dirname(__DIR__, 2) . '/migrations/*.sql') ?: [];
        sort($files);
        $applied = [];
        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (in_array($version, $done, true)) {
                continue;
            }
            $sql = preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($file));
            foreach (array_filter(array_map('trim', preg_split('/;\s*\n/', (string) $sql))) as $stmt) {
                $pdo->exec($stmt);
            }
            $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP())')->execute([$version]);
            $applied[] = $version;
        }
        return $applied;
    }
}
