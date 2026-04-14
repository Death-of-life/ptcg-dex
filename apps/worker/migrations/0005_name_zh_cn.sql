ALTER TABLE cards ADD COLUMN name_zh_cn TEXT;

UPDATE cards
SET name_zh_cn = name
WHERE name_zh_cn IS NULL OR name_zh_cn = '';

CREATE INDEX IF NOT EXISTS idx_cards_lang_name_zh_cn ON cards(lang, name_zh_cn);
