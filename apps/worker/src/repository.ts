import { SORTABLE_FIELDS, type SupportedLang } from "./constants";
import type { CardDetail, CardListItem, FiltersResponse, ListCardsQuery } from "./types";

const normalizePublicBaseUrl = (value: string): string => {
  const raw = (value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

const withTypeFilter = (query: ListCardsQuery, where: string[], params: unknown[]) => {
  if (!query.type) return;
  where.push(
    "EXISTS (SELECT 1 FROM card_types t WHERE t.lang = c.lang AND t.card_id = c.id AND t.type = ?)"
  );
  params.push(query.type);
};

const applyCommonFilter = (query: ListCardsQuery) => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.name) {
    where.push("c.name LIKE ?");
    params.push(`%${query.name}%`);
  }
  if (query.setId) {
    where.push("c.set_id = ?");
    params.push(query.setId);
  }
  if (query.rarity) {
    where.push("c.rarity = ?");
    params.push(query.rarity);
  }
  if (typeof query.hpMin === "number") {
    where.push("c.hp >= ?");
    params.push(query.hpMin);
  }
  if (typeof query.hpMax === "number") {
    where.push("c.hp <= ?");
    params.push(query.hpMax);
  }

  withTypeFilter(query, where, params);

  return { where, params };
};

export const listCards = async (
  db: D1Database,
  lang: SupportedLang,
  query: ListCardsQuery,
  r2PublicBaseUrl: string
): Promise<{ items: CardListItem[]; total: number; page: number; pageSize: number }> => {
  const { where, params } = applyCommonFilter(query);

  const whereSql = [`c.lang = ?`, ...where].join(" AND ");
  const whereParams = [lang, ...params];
  const offset = (query.page - 1) * query.pageSize;
  const sortField = SORTABLE_FIELDS[query.sortBy] ?? SORTABLE_FIELDS.name;

  const listSql = `
    SELECT
      c.lang,
      c.id,
      c.local_id AS localId,
      c.name,
      c.category,
      c.rarity,
      c.set_id AS setId,
      c.set_name AS setName,
      c.illustrator,
      c.hp,
      c.image_base AS imageBase,
      GROUP_CONCAT(ct.type) AS typesCsv
    FROM cards c
    LEFT JOIN card_types ct ON ct.lang = c.lang AND ct.card_id = c.id
    WHERE ${whereSql}
    GROUP BY c.lang, c.id
    ORDER BY ${sortField} ${query.sortOrder.toUpperCase()}, c.id ASC
    LIMIT ? OFFSET ?
  `;

  const rowsResult = await db
    .prepare(listSql)
    .bind(...whereParams, query.pageSize, offset)
    .all<Record<string, unknown>>();

  const countSql = `SELECT COUNT(*) as total FROM cards c WHERE ${whereSql}`;
  const totalResult = await db
    .prepare(countSql)
    .bind(...whereParams)
    .first<{ total: number | string }>();

  const normalizedPublicBaseUrl = normalizePublicBaseUrl(r2PublicBaseUrl);

  const items: CardListItem[] = (rowsResult.results ?? []).map((row) => {
    const setId = typeof row.setId === "string" ? row.setId : null;
    const id = String(row.id ?? "");
    const imageBase = typeof row.imageBase === "string" ? row.imageBase : null;
    const root = normalizedPublicBaseUrl;
    const imageVariants = root && setId
      ? {
          lowWebp: `${root}/cards/${lang}/${setId}/${id}/low.webp`,
          highWebp: `${root}/cards/${lang}/${setId}/${id}/high.webp`,
          lowPng: `${root}/cards/${lang}/${setId}/${id}/low.png`,
          highPng: `${root}/cards/${lang}/${setId}/${id}/high.png`
        }
      : imageBase
        ? {
            lowWebp: `${imageBase}/low.webp`,
            highWebp: `${imageBase}/high.webp`,
            lowPng: `${imageBase}/low.png`,
            highPng: `${imageBase}/high.png`
          }
        : undefined;

    return {
      lang,
      id,
      localId: (row.localId as string | null) ?? null,
      name: String(row.name ?? ""),
      category: (row.category as string | null) ?? null,
      rarity: (row.rarity as string | null) ?? null,
      setId,
      setName: (row.setName as string | null) ?? null,
      illustrator: (row.illustrator as string | null) ?? null,
      hp: (row.hp as number | null) ?? null,
      imageBase,
      types: String(row.typesCsv ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      imageVariants
    };
  });

  const totalRaw = totalResult?.total ?? 0;
  const total = typeof totalRaw === "string" ? Number(totalRaw) : Number(totalRaw);

  return {
    items,
    total: Number.isFinite(total) ? total : 0,
    page: query.page,
    pageSize: query.pageSize
  };
};

export const getCardById = async (
  db: D1Database,
  lang: SupportedLang,
  id: string,
  r2PublicBaseUrl: string
): Promise<CardDetail | null> => {
  const row = await db
    .prepare(
      `SELECT payload, image_base as imageBase, set_id as setId FROM cards WHERE lang = ? AND id = ? LIMIT 1`
    )
    .bind(lang, id)
    .first<{ payload: string; imageBase?: string | null; setId?: string | null }>();

  if (!row?.payload) return null;

  const parsed = JSON.parse(row.payload) as CardDetail;
  parsed.lang = lang;

  const root = normalizePublicBaseUrl(r2PublicBaseUrl);
  if (root && row.setId) {
    parsed.imageVariants = {
      lowWebp: `${root}/cards/${lang}/${row.setId}/${id}/low.webp`,
      highWebp: `${root}/cards/${lang}/${row.setId}/${id}/high.webp`,
      lowPng: `${root}/cards/${lang}/${row.setId}/${id}/low.png`,
      highPng: `${root}/cards/${lang}/${row.setId}/${id}/high.png`
    };
  } else if (row.imageBase) {
    parsed.imageVariants = {
      lowWebp: `${row.imageBase}/low.webp`,
      highWebp: `${row.imageBase}/high.webp`,
      lowPng: `${row.imageBase}/low.png`,
      highPng: `${row.imageBase}/high.png`
    };
  }

  return parsed;
};

export const getFilters = async (
  db: D1Database,
  lang: SupportedLang
): Promise<FiltersResponse> => {
  const rows = await db
    .prepare(`SELECT kind, value FROM filters WHERE lang = ? ORDER BY kind, value`)
    .bind(lang)
    .all<{ kind: string; value: string }>();

  if ((rows.results ?? []).length > 0) {
    const byKind = new Map<string, string[]>();
    for (const row of rows.results ?? []) {
      const values = byKind.get(row.kind) ?? [];
      values.push(row.value);
      byKind.set(row.kind, values);
    }

    return {
      lang,
      types: byKind.get("type") ?? [],
      rarities: byKind.get("rarity") ?? [],
      illustrators: byKind.get("illustrator") ?? [],
      sets: (byKind.get("set") ?? []).map((x) => {
        const [id, ...nameParts] = x.split("|");
        return { id, name: nameParts.join("|") || id };
      }),
      hp: (byKind.get("hp") ?? []).map((x) => Number(x)).filter((n) => Number.isFinite(n))
    };
  }

  const [types, rarities, illustrators, sets, hp] = await Promise.all([
    db
      .prepare(`SELECT DISTINCT type FROM card_types WHERE lang = ? ORDER BY type`)
      .bind(lang)
      .all<{ type: string }>(),
    db
      .prepare(`SELECT DISTINCT rarity FROM cards WHERE lang = ? AND rarity IS NOT NULL ORDER BY rarity`)
      .bind(lang)
      .all<{ rarity: string }>(),
    db
      .prepare(
        `SELECT DISTINCT illustrator FROM cards WHERE lang = ? AND illustrator IS NOT NULL ORDER BY illustrator`
      )
      .bind(lang)
      .all<{ illustrator: string }>(),
    db
      .prepare(`SELECT DISTINCT set_id as id, set_name as name FROM cards WHERE lang = ? AND set_id IS NOT NULL ORDER BY set_name`)
      .bind(lang)
      .all<{ id: string; name: string }>(),
    db
      .prepare(`SELECT DISTINCT hp FROM cards WHERE lang = ? AND hp IS NOT NULL ORDER BY hp`)
      .bind(lang)
      .all<{ hp: number }>()
  ]);

  return {
    lang,
    types: (types.results ?? []).map((x) => x.type),
    rarities: (rarities.results ?? []).map((x) => x.rarity),
    illustrators: (illustrators.results ?? []).map((x) => x.illustrator),
    sets: (sets.results ?? []).map((x) => ({ id: x.id, name: x.name ?? x.id })),
    hp: (hp.results ?? []).map((x) => Number(x.hp)).filter((n) => Number.isFinite(n))
  };
};
