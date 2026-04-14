import type { SupportedLang } from "./constants";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  CARD_IMAGES: R2Bucket;
  R2_PUBLIC_BASE_URL: string;
  CACHE_TTL_SECONDS?: string;
}

export interface ListCardsQuery {
  name?: string;
  setId?: string;
  rarity?: string;
  type?: string;
  hpMin?: number;
  hpMax?: number;
  page: number;
  pageSize: number;
  sortBy: "name" | "hp" | "updatedAt";
  sortOrder: "asc" | "desc";
}

export interface CardListItem {
  lang: SupportedLang;
  id: string;
  logicalId?: string;
  defaultPrintingId?: string;
  printingsCount?: number;
  localId?: string | null;
  name: string;
  category?: string | null;
  rarity?: string | null;
  setId?: string | null;
  setName?: string | null;
  illustrator?: string | null;
  hp?: number | null;
  imageBase?: string | null;
  types: string[];
  imageVariants?: Record<string, string>;
}

export interface CardDetail extends Record<string, unknown> {
  lang: SupportedLang;
  logicalId?: string;
  defaultPrintingId?: string;
  printings?: Array<{
    id: string;
    localId?: string | null;
    setId?: string | null;
    setName?: string | null;
    imageVariants?: Record<string, string>;
  }>;
  imageVariants?: Record<string, string>;
}

export interface FiltersResponse {
  lang: SupportedLang;
  types: string[];
  rarities: string[];
  illustrators: string[];
  sets: Array<{ id: string; name: string }>;
  hp: number[];
}
