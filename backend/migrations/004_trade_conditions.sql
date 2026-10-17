-- 004: o estado de conservação acompanha cada carta da proposta de troca (registrado no momento da proposta).
ALTER TABLE trade_items ADD COLUMN card_condition VARCHAR(3) NOT NULL DEFAULT 'NM' AFTER finish;

-- Tabelas de preços de uma versão descartada (só existem em bancos que chegaram a aplicá-la).
DROP TABLE IF EXISTS card_prices;
DROP TABLE IF EXISTS price_checks;
DROP TABLE IF EXISTS price_history;
DROP TABLE IF EXISTS fx_rates;
