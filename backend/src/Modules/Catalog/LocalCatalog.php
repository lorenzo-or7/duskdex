<?php
declare(strict_types=1);

namespace DuskDex\Modules\Catalog;

use DuskDex\Kernel\Env;

/**
 * Leitura da base local de cartas (frontend/data/catalog, gerada por tools/build-catalog.mjs).
 * Permite ao servidor validar cartas sem depender da API da TCGdex (funciona offline / XAMPP).
 * Produz o mesmo formato de snapshot que o frontend.
 */
final class LocalCatalog
{
    private static array $sets = [];
    private static array $series = [];

    private static function root(): string
    {
        $custom = Env::get('CATALOG_PATH');
        if ($custom) {
            return rtrim($custom, '/\\');
        }
        // projeto: frontend/data/catalog · pacote de hospedagem (site na raiz): data/catalog
        $base = dirname(__DIR__, 4);
        return is_dir($base . '/frontend/data/catalog') ? $base . '/frontend/data/catalog' : $base . '/data/catalog';
    }

    private static function sets(string $lang): ?array
    {
        if (!array_key_exists($lang, self::$sets)) {
            $f = self::root() . "/$lang/sets.json";
            self::$sets[$lang] = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: null) : null;
        }
        return self::$sets[$lang];
    }

    private static function serie(string $lang, string $serieId): ?array
    {
        $k = "$lang:$serieId";
        if (!array_key_exists($k, self::$series)) {
            if (count(self::$series) >= 2) { array_shift(self::$series); } // limita a memória (séries grandes têm dezenas de MB)
            $f = self::root() . "/$lang/series/" . rawurlencode($serieId) . '.json.gz';
            $raw = is_file($f) ? @gzdecode((string) file_get_contents($f)) : false;
            self::$series[$k] = $raw !== false && $raw !== null ? json_decode($raw, true) : null;
        }
        return self::$series[$k];
    }

    public static function card(string $lang, string $id): ?array
    {
        if (!preg_match('/^[a-z]{2}(-[a-z]{2})?$/', $lang) || !preg_match('/^[A-Za-z0-9._-]{1,60}$/', $id)) { return null; }
        $sets = self::sets($lang);
        if (!$sets) { return null; }
        // id = "<setId>-<localId>"; o setId pode conter hífen → tenta do prefixo mais longo
        $parts = explode('-', $id);
        for ($i = count($parts) - 1; $i >= 1; $i--) {
            $setId = implode('-', array_slice($parts, 0, $i));
            if (!isset($sets[$setId])) { continue; }
            $set = $sets[$setId];
            $serie = self::serie($lang, $set['serie']['id']);
            foreach ($serie['sets'][$setId] ?? [] as $c) {
                if ($c['id'] === $id) { return self::snapshot($c, $set, $lang); }
            }
            return null;
        }
        return null;
    }

    private static function snapshot(array $c, array $s, string $lang): array
    {
        $alt = !empty($s['alt']) && !empty($c['alt']) ? ['k' => $s['alt']['k'], 'id' => $s['alt']['id'], 'n' => $c['alt']] : null;
        return [
            'key' => "$lang:{$c['id']}", 'id' => $c['id'], 'localId' => (string) $c['localId'], 'name' => $c['name'], 'lang' => $lang,
            // cartas que só existem na base PokemonTCG (ex.: “88a”) não têm imagem na TCGdex
            'image' => !empty($c['extra']) ? null : "{$s['imageBase']}/{$c['localId']}", 'enImage' => !empty($c['extra']) || empty($s['enBase']) ? null : "{$s['enBase']}/{$c['localId']}", 'alt' => $alt,
            'category' => $c['category'] ?? null, 'rarity' => $c['rarity'] ?? null, 'illustrator' => $c['illustrator'] ?? null, 'hp' => $c['hp'] ?? null,
            'types' => $c['types'] ?? [], 'stage' => $c['stage'] ?? null, 'dexId' => $c['dexId'] ?? [], 'evolveFrom' => $c['evolveFrom'] ?? null,
            'energyType' => $c['energyType'] ?? null, 'trainerType' => $c['trainerType'] ?? null, 'regulationMark' => $c['regulationMark'] ?? null,
            'variants' => $c['variants'] ?? null, 'legal' => $c['legal'] ?? null, 'effect' => $c['effect'] ?? null,
            'attacks' => $c['attacks'] ?? [], 'abilities' => $c['abilities'] ?? [], 'weaknesses' => $c['weaknesses'] ?? [], 'retreat' => $c['retreat'] ?? null,
            'description' => $c['description'] ?? null,
            'set' => ['id' => $s['id'], 'name' => $s['name'], 'logo' => $s['logo'] ?? null, 'symbol' => $s['symbol'] ?? null,
                'logos' => array_values(array_filter([$s['logo'] ?? null, !empty($s['enBase']) ? "{$s['enBase']}/logo" : null, $s['alt']['logo'] ?? null])),
                'symbols' => array_values(array_filter([$s['symbol'] ?? null, $s['alt']['symbol'] ?? null])), 'cardCount' => $s['cardCount'] ?? null],
            'partial' => false, 'source' => 'tcgdex', 'verified' => true, 'fetchedAt' => gmdate('c'),
        ];
    }
}
