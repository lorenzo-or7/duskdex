<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

use PDO;

/** Conexão PDO com prepared statements reais e transações com nova tentativa em deadlock. */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                Env::get('DB_HOST', '127.0.0.1'), Env::int('DB_PORT', 3306), Env::get('DB_DATABASE', 'duskdex'));
            self::$pdo = new PDO($dsn, Env::get('DB_USERNAME', 'root'), Env::get('DB_PASSWORD', ''), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
            self::$pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
        }
        return self::$pdo;
    }

    public static function setPdo(?PDO $pdo): void { self::$pdo = $pdo; }

    /** Explica em português por que a conexão falhou (sem revelar senhas). */
    public static function diagnose(\Throwable $e): string
    {
        $msg = $e->getMessage();
        $code = $e instanceof \PDOException ? (int) ($e->errorInfo[1] ?? 0) : 0;
        $db = Env::get('DB_DATABASE', 'duskdex');
        $user = Env::get('DB_USERNAME', 'root');
        $where = Env::get('DB_HOST', '127.0.0.1') . ':' . Env::int('DB_PORT', 3306);
        $env = is_file(dirname(__DIR__, 3) . '/.env') ? '' : ' (arquivo .env não encontrado na raiz do projeto: usando os valores padrão)';
        return match (true) {
            str_contains($msg, 'could not find driver') => 'A extensão pdo_mysql do PHP está desativada. No php.ini, remova o “;” da linha extension=pdo_mysql e reinicie.',
            $code === 2002 || str_contains($msg, 'Connection refused') || str_contains($msg, 'No such file') => "O MySQL não está rodando em $where. No XAMPP, clique em “Start” no MySQL.$env",
            $code === 1045 || $code === 1698 => "O MySQL recusou o usuário “{$user}” ou a senha do .env. No XAMPP padrão use DB_USERNAME=root e DB_PASSWORD= (vazio).$env",
            $code === 1044 => "O usuário “{$user}” não tem permissão no banco “{$db}”. Use DB_USERNAME=root no XAMPP ou dê permissão (GRANT ALL) a esse usuário.",
            $code === 1049 => "O banco “{$db}” não existe. Rode: php backend/bin/migrate.php (ele cria o banco) — ou crie-o no phpMyAdmin.",
            $code === 2006 || $code === 2013 => "A conexão com o MySQL em $where caiu. Verifique se o serviço está estável.",
            default => 'Não foi possível conectar ao banco de dados: ' . preg_replace('/\s+/', ' ', mb_substr($msg, 0, 200)) . $env,
        };
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::exec($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    /** Executa $fn em transação; repete até 3 vezes em deadlock/lock wait timeout. */
    public static function transaction(callable $fn): mixed
    {
        $attempts = 0;
        while (true) {
            $pdo = self::pdo();
            $pdo->beginTransaction();
            try {
                $result = $fn();
                $pdo->commit();
                return $result;
            } catch (\PDOException $e) {
                $pdo->rollBack();
                $code = (int) ($e->errorInfo[1] ?? 0);
                if (in_array($code, [1213, 1205], true) && ++$attempts < 3) {
                    usleep(50000 * $attempts);
                    continue;
                }
                if ($code === 1062) {
                    throw HttpException::conflict('Operação viola uma restrição de unicidade (registro duplicado ou bolso já ocupado).');
                }
                throw $e;
            } catch (\Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
        }
    }
}
