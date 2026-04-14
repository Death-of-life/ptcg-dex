export const LANGS = ["en", "ja", "zh-tw"] as const;
export type Lang = (typeof LANGS)[number];

export type CardListItem = {
  lang: Lang;
  id: string;
  logicalId?: string;
  defaultPrintingId?: string;
  printingsCount?: number;
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

export type CardPrinting = {
  id: string;
  localId?: string | null;
  setId?: string | null;
  setName?: string | null;
  imageVariants?: {
    lowWebp?: string;
    highWebp?: string;
    lowPng?: string;
    highPng?: string;
  };
};

export type CardDetail = {
  lang: Lang;
  id?: string;
  logicalId?: string;
  defaultPrintingId?: string;
  name?: string;
  category?: string;
  rarity?: string;
  set?: { id?: string; name?: string };
  types?: string[];
  hp?: number;
  illustrator?: string;
  stage?: string;
  regulationMark?: string;
  abilities?: Array<{ name?: string; type?: string; effect?: string }>;
  attacks?: Array<{ name?: string; damage?: string | number; cost?: string[]; effect?: string }>;
  rules?: string[];
  effect?: string;
  description?: string;
  imageVariants?: CardPrinting["imageVariants"];
  printings?: CardPrinting[];
};

export type FiltersResponse = {
  lang: Lang;
  types: string[];
  rarities: string[];
  illustrators: string[];
  sets: Array<{ id: string; name: string }>;
  hp: number[];
};
