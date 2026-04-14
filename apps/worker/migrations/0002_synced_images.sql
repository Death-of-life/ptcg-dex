CREATE TABLE IF NOT EXISTS synced_images (
  object_key TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  card_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  quality TEXT NOT NULL,
  ext TEXT NOT NULL,
  source_image_base TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_synced_images_lang_card
  ON synced_images(lang, card_id);
