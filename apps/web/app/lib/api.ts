import type { CardDetail, CardsResponse, FiltersResponse, Lang } from "./types";

const resolveApiBase = (): string => {
  const configured = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://127.0.0.1:8787";
    }
  }

  throw new Error("未配置 NEXT_PUBLIC_API_BASE_URL（线上环境必须配置）");
};

const buildUrl = (path: string, query?: URLSearchParams) => {
  const API_BASE = resolveApiBase();
  const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  return `${base}${path}${query ? `?${query.toString()}` : ""}`;
};

export type CardQuery = {
  name?: string;
  setId?: string;
  rarity?: string;
  type?: string;
  illustrator?: string;
  hpMin?: number;
  hpMax?: number;
  sortBy?: "name" | "hp" | "updatedAt";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export const fetchCards = async (lang: Lang, query: CardQuery): Promise<CardsResponse> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const resp = await fetch(buildUrl(`/v1/${lang}/cards`, params), { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`查询失败: ${resp.status}`);
  }
  return (await resp.json()) as CardsResponse;
};

export const fetchFilters = async (lang: Lang): Promise<FiltersResponse> => {
  const resp = await fetch(buildUrl(`/v1/${lang}/filters`), { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`过滤器加载失败: ${resp.status}`);
  }
  return (await resp.json()) as FiltersResponse;
};

export const fetchCardDetail = async (lang: Lang, id: string): Promise<CardDetail> => {
  const resp = await fetch(buildUrl(`/v1/${lang}/cards/${encodeURIComponent(id)}`), { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`详情加载失败: ${resp.status}`);
  }
  const payload = (await resp.json()) as { card: CardDetail };
  return payload.card;
};
