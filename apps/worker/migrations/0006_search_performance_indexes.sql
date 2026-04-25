CREATE INDEX IF NOT EXISTS idx_synced_images_lookup
  ON synced_images(lang, card_id, quality, ext);

CREATE TABLE IF NOT EXISTS card_search_terms (
  lang TEXT NOT NULL,
  term TEXT NOT NULL,
  card_id TEXT NOT NULL,
  PRIMARY KEY (lang, term, card_id)
);

CREATE INDEX IF NOT EXISTS idx_card_search_terms_card
  ON card_search_terms(lang, card_id);

CREATE INDEX IF NOT EXISTS idx_cards_visible_name
  ON cards(lang, has_image, name);

CREATE INDEX IF NOT EXISTS idx_cards_visible_name_zh_cn
  ON cards(lang, has_image, name_zh_cn);

CREATE INDEX IF NOT EXISTS idx_cards_visible_logical_updated
  ON cards(lang, has_image, logical_id, updated_at, id);
