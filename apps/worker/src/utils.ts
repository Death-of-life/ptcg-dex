import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORTABLE_FIELDS,
  SUPPORTED_LANGS,
  type SortField,
  type SupportedLang
} from "./constants";
import type { ListCardsQuery } from "./types";

export const isSupportedLang = (lang: string): lang is SupportedLang => {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
};

export const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseListQuery = (url: URL): ListCardsQuery => {
  const pageRaw = parseNumber(url.searchParams.get("page") ?? undefined);
  const pageSizeRaw = parseNumber(url.searchParams.get("pageSize") ?? undefined);
  const sortByRaw = url.searchParams.get("sortBy") as SortField | null;
  const sortOrderRaw = (url.searchParams.get("sortOrder") ?? "asc").toLowerCase();

  const sortBy: SortField = sortByRaw && sortByRaw in SORTABLE_FIELDS ? sortByRaw : "name";
  const sortOrder: "asc" | "desc" = sortOrderRaw === "desc" ? "desc" : "asc";

  return {
    name: url.searchParams.get("name") ?? undefined,
    setId: url.searchParams.get("setId") ?? undefined,
    rarity: url.searchParams.get("rarity") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    regulationMark: url.searchParams.get("regulationMark") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    trainerType: url.searchParams.get("trainerType") ?? undefined,
    energyType: url.searchParams.get("energyType") ?? undefined,
    illustrator: url.searchParams.get("illustrator") ?? undefined,
    hpMin: parseNumber(url.searchParams.get("hpMin") ?? undefined),
    hpMax: parseNumber(url.searchParams.get("hpMax") ?? undefined),
    page: pageRaw && pageRaw > 0 ? Math.floor(pageRaw) : 1,
    pageSize: pageSizeRaw ? Math.min(Math.max(Math.floor(pageSizeRaw), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    sortBy,
    sortOrder
  };
};

export const buildImageVariants = (
  imageBase: string | null | undefined,
  r2PublicBaseUrl: string,
  lang: SupportedLang,
  setId?: string | null,
  cardId?: string | null
): Record<string, string> | undefined => {
  const fallback = (quality: string, ext: string) => `${imageBase}/${quality}.${ext}`;

  if (!imageBase && (!setId || !cardId)) return undefined;

  const normalizedBase = r2PublicBaseUrl?.replace(/\/$/, "");

  if (!normalizedBase || !setId || !cardId) {
    if (!imageBase) return undefined;
    return {
      lowWebp: fallback("low", "webp"),
      highWebp: fallback("high", "webp"),
      lowPng: fallback("low", "png"),
      highPng: fallback("high", "png")
    };
  }

  const root = `${normalizedBase}/cards/${lang}/${setId}/${cardId}`;
  return {
    lowWebp: `${root}/low.webp`,
    highWebp: `${root}/high.webp`,
    lowPng: `${root}/low.png`,
    highPng: `${root}/high.png`
  };
};

export const jsonResponse = (payload: unknown, status = 200): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
};

export const errorResponse = (
  status: number,
  title: string,
  detail: string,
  lang?: string
): Response => {
  return jsonResponse(
    {
      status,
      title,
      detail,
      ...(lang ? { lang } : {})
    },
    status
  );
};
