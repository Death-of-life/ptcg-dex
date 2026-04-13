export const SUPPORTED_LANGS = ["en", "ja", "zh-tw"] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export const SORTABLE_FIELDS = {
  name: "c.name",
  hp: "c.hp",
  updatedAt: "c.updated_at"
} as const;

export type SortField = keyof typeof SORTABLE_FIELDS;

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
