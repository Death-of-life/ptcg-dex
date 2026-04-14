import type { SupportedLang } from "./constants";
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
    where.push("(c.name LIKE ? OR c.name_zh_cn LIKE ?)");
    params.push(`%${query.name}%`, `%${query.name}%`);
  }
  if (query.setId) {
    where.push("c.set_id = ?");
    params.push(query.setId);
  }
  if (query.rarity) {
    where.push("c.rarity = ?");
    params.push(query.rarity);
  }
  if (query.illustrator) {
    where.push("c.illustrator = ?");
    params.push(query.illustrator);
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
  const sortFieldMap: Record<ListCardsQuery["sortBy"], string> = {
    name: "r.name",
    hp: "r.hp",
    updatedAt: "r.updatedAt"
  };
  const sortField = sortFieldMap[query.sortBy] ?? sortFieldMap.name;

  const listSql = `
    WITH filtered AS (
      SELECT
        c.lang,
        c.id,
        c.local_id AS localId,
        COALESCE(NULLIF(c.logical_id, ''), c.id) AS logicalId,
        c.name,
        c.category,
        c.rarity,
        c.set_id AS setId,
        c.set_name AS setName,
        c.illustrator,
        c.hp,
        c.image_base AS imageBase,
        c.updated_at AS updatedAt
      FROM cards c
      WHERE ${whereSql}
        AND EXISTS (
          SELECT 1
          FROM synced_images si
          WHERE si.lang = c.lang
            AND si.card_id = c.id
            AND si.quality = 'low'
            AND si.ext = 'webp'
        )
    ),
    ranked AS (
      SELECT
        f.*,
        ROW_NUMBER() OVER (PARTITION BY f.logicalId ORDER BY f.updatedAt DESC, f.id ASC) AS rn,
        COUNT(*) OVER (PARTITION BY f.logicalId) AS printingsCount
      FROM filtered f
    )
    SELECT
      r.lang,
      r.id,
      r.logicalId,
      r.printingsCount,
      r.localId,
      r.name,
      r.category,
      r.rarity,
      r.setId,
      r.setName,
      r.illustrator,
      r.hp,
      r.imageBase,
      GROUP_CONCAT(DISTINCT ct.type) AS typesCsv
    FROM ranked r
    LEFT JOIN card_types ct ON ct.lang = r.lang AND ct.card_id = r.id
    WHERE r.rn = 1
    GROUP BY r.lang, r.id, r.logicalId, r.printingsCount, r.localId, r.name, r.category, r.rarity, r.setId, r.setName, r.illustrator, r.hp, r.imageBase, r.updatedAt
    ORDER BY ${sortField} ${query.sortOrder.toUpperCase()}, r.id ASC
    LIMIT ? OFFSET ?
  `;

  const rowsResult = await db
    .prepare(listSql)
    .bind(...whereParams, query.pageSize, offset)
    .all<Record<string, unknown>>();

  const countSql = `
    SELECT COUNT(*) as total
    FROM (
      SELECT COALESCE(NULLIF(c.logical_id, ''), c.id) AS logicalId
      FROM cards c
      WHERE ${whereSql}
        AND EXISTS (
          SELECT 1
          FROM synced_images si
          WHERE si.lang = c.lang
            AND si.card_id = c.id
            AND si.quality = 'low'
            AND si.ext = 'webp'
        )
      GROUP BY COALESCE(NULLIF(c.logical_id, ''), c.id)
    ) q
  `;
  const totalResult = await db
    .prepare(countSql)
    .bind(...whereParams)
    .first<{ total: number | string }>();

  const normalizedPublicBaseUrl = normalizePublicBaseUrl(r2PublicBaseUrl);

  const items: CardListItem[] = (rowsResult.results ?? []).map((row) => {
    const setId = typeof row.setId === "string" ? row.setId : null;
    const defaultPrintingId = String(row.id ?? "");
    const logicalId = String(row.logicalId ?? defaultPrintingId);
    const root = normalizedPublicBaseUrl;
    const imageVariants = root && setId
      ? {
          lowWebp: `${root}/cards/${lang}/${setId}/${defaultPrintingId}/low.webp`,
          highWebp: `${root}/cards/${lang}/${setId}/${defaultPrintingId}/high.webp`,
          lowPng: `${root}/cards/${lang}/${setId}/${defaultPrintingId}/low.png`,
          highPng: `${root}/cards/${lang}/${setId}/${defaultPrintingId}/high.png`
        }
      : undefined;

    return {
      lang,
      id: logicalId,
      logicalId,
      defaultPrintingId,
      printingsCount: Number(row.printingsCount ?? 1) || 1,
      localId: (row.localId as string | null) ?? null,
      name: String(row.name ?? ""),
      category: (row.category as string | null) ?? null,
      rarity: (row.rarity as string | null) ?? null,
      setId,
      setName: (row.setName as string | null) ?? null,
      illustrator: (row.illustrator as string | null) ?? null,
      hp: (row.hp as number | null) ?? null,
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
  const rows = await db
    .prepare(
      `
      SELECT
        c.id,
        c.local_id as localId,
        COALESCE(NULLIF(c.logical_id, ''), c.id) as logicalId,
        c.set_id as setId,
        c.set_name as setName,
        c.payload
      FROM cards c
      WHERE c.lang = ?
        AND (COALESCE(NULLIF(c.logical_id, ''), c.id) = ? OR c.id = ?)
        AND EXISTS (
          SELECT 1
          FROM synced_images si
          WHERE si.lang = c.lang
            AND si.card_id = c.id
            AND si.quality = 'low'
            AND si.ext = 'webp'
        )
      ORDER BY c.updated_at DESC, c.id ASC
    `
    )
    .bind(lang, id, id)
    .all<{ id: string; logicalId: string; localId?: string | null; setId?: string | null; setName?: string | null; payload: string }>();

  if ((rows.results ?? []).length === 0) return null;
  const first = rows.results![0];
  const parsed = JSON.parse(first.payload) as CardDetail;
  parsed.lang = lang;
  parsed.logicalId = first.logicalId ?? id;
  parsed.defaultPrintingId = first.id;

  const root = normalizePublicBaseUrl(r2PublicBaseUrl);
  parsed.printings = (rows.results ?? []).map((printing) => ({
    id: printing.id,
    localId: printing.localId ?? null,
    setId: printing.setId ?? null,
    setName: printing.setName ?? null,
    imageVariants:
      root && printing.setId
        ? {
            lowWebp: `${root}/cards/${lang}/${printing.setId}/${printing.id}/low.webp`,
            highWebp: `${root}/cards/${lang}/${printing.setId}/${printing.id}/high.webp`,
            lowPng: `${root}/cards/${lang}/${printing.setId}/${printing.id}/low.png`,
            highPng: `${root}/cards/${lang}/${printing.setId}/${printing.id}/high.png`
          }
        : undefined
  }));

  parsed.imageVariants = parsed.printings[0]?.imageVariants;

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
