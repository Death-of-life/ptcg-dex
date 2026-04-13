CREATE TABLE IF NOT EXISTS cards (
  lang TEXT NOT NULL,
  id TEXT NOT NULL,
  local_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  rarity TEXT,
  set_id TEXT,
  set_name TEXT,
  illustrator TEXT,
  hp INTEGER,
  image_base TEXT,
  payload TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lang, id)
);

CREATE INDEX IF NOT EXISTS idx_cards_lang_name ON cards(lang, name);
CREATE INDEX IF NOT EXISTS idx_cards_lang_set ON cards(lang, set_id);
CREATE INDEX IF NOT EXISTS idx_cards_lang_rarity ON cards(lang, rarity);
CREATE INDEX IF NOT EXISTS idx_cards_lang_hp ON cards(lang, hp);

CREATE TABLE IF NOT EXISTS card_types (
  lang TEXT NOT NULL,
  card_id TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (lang, card_id, type),
  FOREIGN KEY (lang, card_id) REFERENCES cards(lang, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_types_lang_type ON card_types(lang, type);

CREATE TABLE IF NOT EXISTS filters (
  lang TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lang, kind, value)
);

CREATE TABLE IF NOT EXISTS source_hashes (
  lang TEXT NOT NULL,
  id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  payload_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lang, id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
