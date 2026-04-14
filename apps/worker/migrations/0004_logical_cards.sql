ALTER TABLE cards ADD COLUMN logical_id TEXT;
ALTER TABLE cards ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;

UPDATE cards
SET logical_id = id
WHERE logical_id IS NULL OR logical_id = '';

CREATE INDEX IF NOT EXISTS idx_cards_lang_logical ON cards(lang, logical_id);
CREATE INDEX IF NOT EXISTS idx_cards_lang_has_image ON cards(lang, has_image);
