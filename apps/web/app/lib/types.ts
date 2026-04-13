export const LANGS = ["en", "ja", "zh-tw"] as const;
export type Lang = (typeof LANGS)[number];

export type CardListItem = {
  lang: Lang;
  id: string;
  localId?: string | null;
  name: string;
  rarity?: string | null;
  setId?: string | null;
  setName?: string | null;
  illustrator?: string | null;
  hp?: number | null;
  types: string[];
  imageVariants?: {
    lowWebp?: string;
    highWebp?: string;
    lowPng?: string;
    highPng?: string;
  };
};

export type CardsResponse = {
  items: CardListItem[];
  total: number;
  page: number;
  pageSize: number;
  lang: Lang;
};

export type FiltersResponse = {
  lang: Lang;
  types: string[];
  rarities: string[];
  illustrators: string[];
  sets: Array<{ id: string; name: string }>;
  hp: number[];
};
