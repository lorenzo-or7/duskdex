<?php
declare(strict_types=1);

namespace DuskDex\Modules\Catalog;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Security;
use DuskDex\Modules\Shared\Repo;

/**
 * Snapshots de cartas usados pelo usuário.
 * - Cartas TCGdex: o SERVIDOR consulta a TCGdex e grava um snapshot global verificado (owner_id = 0).
 *   Se a TCGdex estiver indisponível, guarda o snapshot enviado pelo cliente como PRIVADO e não verificado.
 * - Cartas personalizadas: sempre privadas do usuário.
 */
final class CardController
{
    private const KEY_RE = '/^([a-z]{2}(?:-[a-z]{2})?):([A-Za-z0-9._-]{1,60})$/';
    private const CUSTOM_RE = '/^custom:(custom_[a-z0-9]{6,40})$/';

    public static function index(Request $r): array
    {
        $uid = Security::userId();
        $rows = Database::all('SELECT cs.card_key, cs.data, cs.owner_id FROM user_cards uc JOIN card_snapshots cs ON cs.card_key = uc.card_key AND (cs.owner_id = 0 OR cs.owner_id = uc.owner_id) WHERE uc.owner_id = ?', [$uid]);
        $out = [];
        foreach ($rows as $row) {
            // snapshot global verificado tem prioridade sobre o privado
            if (!isset($out[$row['card_key']]) || (int) $row['owner_id'] === 0) {
                $out[$row['card_key']] = Repo::decode($row['data']);
            }
        }
        return array_values($out);
    }

    public static function store(Request $r): array
    {
        $uid = (int) Security::userId();
        $cards = $r->input('cards', []);
        if (!is_array($cards) || count($cards) > 100) {
            throw HttpException::validation('Envie até 100 cartas por vez.');
        }
        $saved = [];
        foreach ($cards as $c) {
            if (!is_array($c)) { continue; }
            $key = (string) ($c['key'] ?? '');
            $now = Repo::now();
            if (preg_match(self::CUSTOM_RE, $key, $m)) {
                $snap = self::cleanCustom($c, $m[1], $key);
                Database::exec('INSERT INTO card_snapshots (owner_id, card_key, card_id, lang, name, data, verified, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), data = VALUES(data), updated_at = VALUES(updated_at)',
                    [$uid, $key, $snap['id'], $snap['lang'], $snap['name'], Repo::json($snap), $now]);
            } elseif (preg_match(self::KEY_RE, $key, $m)) {
                [$all, $lang, $id] = $m;
                $global = Database::one('SELECT data, updated_at FROM card_snapshots WHERE owner_id = 0 AND card_key = ?', [$key]);
                if ($global) {
                    $snap = Repo::decode($global['data']);
                } elseif ($localSnap = LocalCatalog::card($lang, $id)) {
                    // base local embutida (dados da TCGdex): valida sem rede
                    $snap = $localSnap;
                    Database::exec('INSERT INTO card_snapshots (owner_id, card_key, card_id, lang, name, data, verified, updated_at) VALUES (0, ?, ?, ?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
                        [$key, $id, $lang, mb_substr($snap['name'], 0, 160), Repo::json($snap), $now]);
                } elseif ($remote = TcgdexClient::fetchCard($lang, $id)) {
                    $snap = TcgdexClient::toSnapshot($remote, $lang);
                    Database::exec('INSERT INTO card_snapshots (owner_id, card_key, card_id, lang, name, data, verified, updated_at) VALUES (0, ?, ?, ?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
                        [$key, $id, $lang, mb_substr($snap['name'], 0, 160), Repo::json($snap), $now]);
                } else {
                    $snap = self::cleanClient($c, $key, $lang, $id);
                    Database::exec('INSERT INTO card_snapshots (owner_id, card_key, card_id, lang, name, data, verified, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), data = VALUES(data), updated_at = VALUES(updated_at)',
                        [$uid, $key, $id, $lang, $snap['name'], Repo::json($snap), $now]);
                }
            } else {
                throw HttpException::validation("Chave de carta inválida: $key");
            }
            Database::exec('INSERT IGNORE INTO user_cards (owner_id, card_key, created_at) VALUES (?, ?, ?)', [$uid, $key, $now]);
            $saved[] = $snap;
        }
        return $saved;
    }

    private static function s(mixed $v, int $max): ?string
    {
        return is_scalar($v) && $v !== '' ? mb_substr((string) $v, 0, $max) : null;
    }

    /** Snapshot não verificado (TCGdex inacessível pelo servidor): só campos esperados, com limites. */
    private static function cleanClient(array $c, string $key, string $lang, string $id): array
    {
        $img = self::s($c['image'] ?? null, 300);
        if ($img !== null && !str_starts_with($img, 'https://assets.tcgdex.net/')) { $img = null; }
        $enImg = self::s($c['enImage'] ?? null, 300);
        if ($enImg !== null && !str_starts_with($enImg, 'https://assets.tcgdex.net/')) { $enImg = null; }
        $alt = is_array($c['alt'] ?? null) && in_array($c['alt']['k'] ?? '', ['p', 's'], true) && preg_match('/^[A-Za-z0-9.-]{1,30}$/', (string) ($c['alt']['id'] ?? '')) && preg_match('/^[A-Za-z0-9-]{1,20}$/', (string) ($c['alt']['n'] ?? ''))
            ? ['k' => $c['alt']['k'], 'id' => $c['alt']['id'], 'n' => $c['alt']['n']] : null;
        $set = is_array($c['set'] ?? null) ? $c['set'] : [];
        $list = fn ($v, $n = 10) => is_array($v) ? array_slice(array_values(array_filter($v, 'is_scalar')), 0, $n) : [];
        return [
            'key' => $key, 'id' => $id, 'lang' => $lang, 'localId' => self::s($c['localId'] ?? '', 20) ?? '', 'name' => self::s($c['name'] ?? '', 160) ?? $id,
            'image' => $img, 'enImage' => $enImg, 'alt' => $alt, 'category' => in_array($c['category'] ?? null, ['Pokemon', 'Trainer', 'Energy'], true) ? $c['category'] : null,
            'rarity' => self::s($c['rarity'] ?? null, 60), 'types' => $list($c['types'] ?? []), 'stage' => self::s($c['stage'] ?? null, 30),
            'dexId' => array_map('intval', $list($c['dexId'] ?? [])), 'hp' => is_numeric($c['hp'] ?? null) ? (int) $c['hp'] : null,
            'illustrator' => self::s($c['illustrator'] ?? null, 80), 'energyType' => self::s($c['energyType'] ?? null, 20),
            'set' => ['id' => self::s($set['id'] ?? null, 40), 'name' => self::s($set['name'] ?? null, 100), 'cardCount' => is_array($set['cardCount'] ?? null) ? ['official' => (int) ($set['cardCount']['official'] ?? 0), 'total' => (int) ($set['cardCount']['total'] ?? 0)] : null],
            'attacks' => [], 'abilities' => [], 'partial' => true, 'source' => $c['source'] ?? 'client', 'verified' => false,
        ];
    }

    private static function cleanCustom(array $c, string $id, string $key): array
    {
        return [
            'key' => $key, 'id' => $id, 'name' => self::s($c['name'] ?? '', 80) ?? 'Carta personalizada', 'lang' => self::s($c['lang'] ?? 'pt-br', 10) ?? 'pt-br',
            'localId' => self::s($c['localId'] ?? '', 20) ?? '', 'setLabel' => self::s($c['setLabel'] ?? '', 60) ?? '', 'set' => null,
            'category' => in_array($c['category'] ?? null, ['Pokemon', 'Trainer', 'Energy'], true) ? $c['category'] : null,
            'source' => 'custom', 'assetId' => null, 'partial' => false, 'types' => [], 'dexId' => [],
        ];
    }
}
