-- 003: estado de conservação das cópias (M, NM, SP, MP, HP, D, HD).
-- (O nome do arquivo ficou de uma versão com preços, que foi descartada; não renomear: bancos já registraram "003_prices".)

ALTER TABLE card_copies ADD COLUMN card_condition VARCHAR(3) NOT NULL DEFAULT 'NM' AFTER finish;
