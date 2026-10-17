<?php
declare(strict_types=1);

namespace DuskDex\Modules\Catalog;

use DuskDex\Kernel\Env;

/**
 * Cliente da API pública TCGdex (REST v2, somente GET, sem chave).
 * URL: {TCGDEX_BASE}/{lang}/cards/{id}. Referência: https://tcgdex.dev/rest/card
 */
final class TcgdexClient
{
    public static function fetchCard(string $lang, string $id): ?array
    {
        if (!preg_match('/^[a-z]{2}(-[a-z]{2})?$/', $lang) || !preg_match('/^[A-Za-z0-9._-]{1,60}$/', $id)) {
            return null;
        }
        $url = rtrim((string) Env::get('TCGDEX_BASE', 'https://api.tcgdex.net/v2'), '/') . "/$lang/cards/" . rawurlencode($id);
        if (!function_exists('curl_init')) {
            return null;
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => Env::int('TCGDEX_TIMEOUT', 6),
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: DuskDex/0.1 (+https://tcgdex.dev)'],
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 2,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $status !== 200) {
            return null;
        }
        $data = json_decode($body, true);
        return is_array($data) && isset($data['id'], $data['name']) ? $data : null;
    }

    /** Normaliza uma carta TCGdex no mesmo formato de snapshot usado pelo frontend (campos tolerantes). */
    public static function toSnapshot(array $c, string $lang): array
    {
        $set = $c['set'] ?? null;
        $arr = fn ($v) => is_array($v) ? array_values($v) : [];
        return [
            'key' => "$lang:{$c['id']}", 'id' => (string) $c['id'], 'localId' => (string) ($c['localId'] ?? ''), 'name' => (string) $c['name'], 'lang' => $lang,
            'image' => $c['image'] ?? null, 'category' => $c['category'] ?? null, 'rarity' => $c['rarity'] ?? null, 'illustrator' => $c['illustrator'] ?? null,
            'hp' => $c['hp'] ?? null, 'types' => $arr($c['types'] ?? []), 'stage' => $c['stage'] ?? null, 'dexId' => $arr($c['dexId'] ?? []),
            'evolveFrom' => $c['evolveFrom'] ?? null, 'energyType' => $c['energyType'] ?? null, 'trainerType' => $c['trainerType'] ?? null,
            'regulationMark' => $c['regulationMark'] ?? null, 'variants' => $c['variants'] ?? null, 'legal' => $c['legal'] ?? null, 'effect' => $c['effect'] ?? null,
            'attacks' => array_map(fn ($a) => ['name' => $a['name'] ?? '', 'cost' => $arr($a['cost'] ?? []), 'damage' => $a['damage'] ?? null, 'effect' => $a['effect'] ?? null], $arr($c['attacks'] ?? [])),
            'abilities' => array_map(fn ($a) => ['name' => $a['name'] ?? '', 'type' => $a['type'] ?? null, 'effect' => $a['effect'] ?? null], $arr($c['abilities'] ?? [])),
            'weaknesses' => $arr($c['weaknesses'] ?? []), 'retreat' => $c['retreat'] ?? null, 'description' => $c['description'] ?? null,
            'set' => is_array($set) ? ['id' => $set['id'] ?? null, 'name' => $set['name'] ?? null, 'logo' => $set['logo'] ?? null, 'symbol' => $set['symbol'] ?? null, 'cardCount' => $set['cardCount'] ?? null] : null,
            'updated' => $c['updated'] ?? null, 'partial' => !isset($c['category']), 'source' => 'tcgdex', 'verified' => true, 'fetchedAt' => gmdate('c'),
        ];
    }
}
