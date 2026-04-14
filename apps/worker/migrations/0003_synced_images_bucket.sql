ALTER TABLE synced_images ADD COLUMN bucket_name TEXT;
CREATE INDEX IF NOT EXISTS idx_synced_images_lang_bucket_card
  ON synced_images(lang, bucket_name, card_id);
