import { Hono } from "hono";
import { cors } from "hono/cors";
import { cache } from "hono/cache";
import { SUPPORTED_LANGS } from "./constants";
import { getCardById, getFilters, listCards } from "./repository";
import type { Env } from "./types";
import { errorResponse, isSupportedLang, jsonResponse, parseListQuery } from "./utils";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());
app.use("/health", cache({ cacheName: "ptcg-dex-health", cacheControl: "max-age=30" }));

app.get("/health", (c) => {
  return jsonResponse({
    status: "ok",
    service: "ptcg-dex-api",
    langs: SUPPORTED_LANGS,
    timestamp: new Date().toISOString()
  });
});

const registerApiRoutes = (prefix: "/api" | "/v1") => {
  app.get(`${prefix}/:lang/cards`, async (c) => {
    const lang = c.req.param("lang");
    if (!isSupportedLang(lang)) {
      return errorResponse(
        400,
        "Unsupported language",
        "Allowed values: en, ja, zh-tw",
        lang
      );
    }

    const url = new URL(c.req.url);
    const query = parseListQuery(url);
    const cacheKey = `cards:${lang}:${url.searchParams.toString()}`;
    const ttl = Number(c.env.CACHE_TTL_SECONDS ?? "600") || 600;

    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ ...cached, cached: true });
    }

    const result = await listCards(c.env.DB, lang, query, c.env.R2_PUBLIC_BASE_URL);
    const payload = { ...result, lang, cached: false };

    await c.env.CACHE.put(cacheKey, JSON.stringify(payload), {
      expirationTtl: Math.max(30, ttl)
    });

    return jsonResponse(payload);
  });

  app.get(`${prefix}/:lang/cards/:id`, async (c) => {
    const lang = c.req.param("lang");
    const id = c.req.param("id");

    if (!isSupportedLang(lang)) {
      return errorResponse(
        400,
        "Unsupported language",
        "Allowed values: en, ja, zh-tw",
        lang
      );
    }

    const cacheKey = `card:${lang}:${id}`;
    const ttl = Number(c.env.CACHE_TTL_SECONDS ?? "600") || 600;

    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ card: cached, cached: true });
    }

    const card = await getCardById(c.env.DB, lang, id, c.env.R2_PUBLIC_BASE_URL);
    if (!card) {
      return errorResponse(404, "Card not found", `Card ${id} does not exist for ${lang}`, lang);
    }

    await c.env.CACHE.put(cacheKey, JSON.stringify(card), {
      expirationTtl: Math.max(30, ttl)
    });

    return jsonResponse({ card, cached: false });
  });

  app.get(`${prefix}/:lang/filters`, async (c) => {
    const lang = c.req.param("lang");

    if (!isSupportedLang(lang)) {
      return errorResponse(
        400,
        "Unsupported language",
        "Allowed values: en, ja, zh-tw",
        lang
      );
    }

    const cacheKey = `filters:${lang}`;
    const ttl = Number(c.env.CACHE_TTL_SECONDS ?? "600") || 600;

    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ ...cached, cached: true });
    }

    const filters = await getFilters(c.env.DB, lang);

    await c.env.CACHE.put(cacheKey, JSON.stringify(filters), {
      expirationTtl: Math.max(30, ttl)
    });

    return jsonResponse({ ...filters, cached: false });
  });
};

registerApiRoutes("/v1");
registerApiRoutes("/api");

app.notFound(() => {
  return errorResponse(404, "Not found", "Route does not exist");
});

app.onError((err) => {
  console.error(err);
  return errorResponse(500, "Internal server error", err.message);
});

export default app;
