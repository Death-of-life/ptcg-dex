import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { config as loadEnv } from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(scriptDir, "../../../.env") });
loadEnv();

const SUPPORTED_LANGS = ["zh-tw"] as const;
const DEFAULT_REGULATION_MARKS = ["H", "I", "J"] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

type CardListItem = {
  id: string;
  localId?: string;
  name?: string;
  image?: string;
};

type CardDetail = {
  id: string;
  localId?: string;
  name: string;
  category?: string;
  rarity?: string;
  illustrator?: string;
  hp?: number | string;
  image?: string;
  set?: { id?: string; name?: string };
  types?: string[];
  [k: string]: unknown;
};

type SyncSummary = {
  runType: "full" | "incremental";
  startedAt: string;
  finishedAt: string;
  langs: Record<Lang, LangSyncStats>;
};

type LangSyncStats = {
  scanned: number;
  changed: number;
  upserted: number;
  imagesUploaded: number;
  imagesSkipped: number;
  filtersUpdated: number;
};

type ProgressStage = "details" | "d1" | "images";

const cliArgs = process.argv.slice(2);
const hasFlag = (flag: string): boolean => cliArgs.includes(flag);
const getArgValue = (flag: string): string | undefined => {
  const idx = cliArgs.indexOf(flag);
  if (idx < 0) return undefined;
  const value = cliArgs[idx + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
};

const mode = hasFlag("--full") ? "full" : "incremental";
const dryRun = hasFlag("--dry-run");
const withImages = !hasFlag("--no-images");
const MAX_D1_SQL_CHARS = Number(process.env.D1_MAX_SQL_CHARS ?? "50000");

const parseLangs = (): Lang[] => {
  const fromArg = getArgValue("--lang");
  const fromEnv = process.env.SYNC_LANGS;
  const raw = (fromArg ?? fromEnv ?? "").trim();
  if (!raw) return [...SUPPORTED_LANGS];
  const values = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const invalid = values.filter((x) => !(SUPPORTED_LANGS as readonly string[]).includes(x));
  if (invalid.length > 0) {
    throw new Error(`不支持的语言参数: ${invalid.join(", ")}；允许值: ${SUPPORTED_LANGS.join(", ")}`);
  }
  return values as Lang[];
};

const parseRegulationMarks = (): string[] => {
  const raw = (getArgValue("--regulation-mark") ?? process.env.SYNC_REGULATION_MARKS ?? process.env.SYNC_REGULATION_MARK ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return [...DEFAULT_REGULATION_MARKS];
  return raw
    .split(/[\s,]+/)
    .map((mark) => mark.trim())
    .filter(Boolean);
};

const tcgdexBase = ((process.env.TCGDEX_BASE_URL ?? "").trim() || "https://api.tcgdex.net/v2").replace(
  /\/+$/,
  ""
);
const targetLangs = parseLangs();
const targetRegulationMarks = parseRegulationMarks();
const d1DatabaseName = process.env.D1_DATABASE_NAME;
const kvNamespaceId = process.env.KV_NAMESPACE_ID;
const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
const r2PublicBaseUrl = (process.env.CF_R2_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
const r2S3Endpoint = process.env.R2_S3_ENDPOINT?.trim().replace(/\/+$/, "");
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

if (!d1DatabaseName || !kvNamespaceId || !r2BucketName || !r2S3Endpoint || !r2AccessKeyId || !r2SecretAccessKey) {
  console.error(
    "缺少环境变量: D1_DATABASE_NAME, KV_NAMESPACE_ID, R2_BUCKET_NAME, R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY（需要在 GitHub Secrets 或环境中提供）"
  );
  process.exit(1);
}

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();

  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      if (seen.has(input as object)) return null;
      seen.add(input as object);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = walk((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };

  return JSON.stringify(walk(value));
};

const sha1 = (input: unknown) =>
  createHash("sha1").update(stableStringify(input)).digest("hex");

const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

const hmac = (key: string | Buffer, input: string): Buffer =>
  createHmac("sha256", key).update(input).digest();

const awsEncode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

const buildS3Url = (objectKey: string): { url: URL; canonicalUri: string } => {
  const endpoint = new URL(r2S3Endpoint);
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  const encodedBucket = awsEncode(r2BucketName);
  const encodedKey = objectKey.split("/").map(awsEncode).join("/");
  const canonicalUri = `${basePath}/${encodedBucket}/${encodedKey}`.replace(/\/{2,}/g, "/");
  endpoint.pathname = canonicalUri;
  endpoint.search = "";
  return { url: endpoint, canonicalUri };
};

const r2S3Request = async (
  method: "GET" | "PUT",
  objectKey: string,
  body?: Uint8Array
): Promise<ArrayBuffer> => {
  const { url, canonicalUri } = buildS3Url(objectKey);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const host = url.host;
  const region = "auto";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join("\n") + "\n";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${r2SecretAccessKey}`, dateStamp), region), service),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${r2AccessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ");

  const res = await fetch(url, {
    method,
    headers: {
      authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    },
    body: method === "PUT" ? (body as BodyInit) : undefined
  });
  if (!res.ok) {
    const details = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 1000);
    throw new Error(`R2 S3 ${method} ${objectKey} 失败: ${res.status} ${details}`);
  }
  return await res.arrayBuffer();
};

const twToCnConverter = OpenCC.Converter({ from: "tw", to: "cn" });

const toSearchNameZhCn = (lang: Lang, name?: string): string => {
  const normalized = String(name ?? "").trim();
  if (!normalized) return "";
  if (lang === "zh-tw") {
    return twToCnConverter(normalized);
  }
  return normalized;
};

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const buildLogicalSignature = (card: CardDetail): Record<string, unknown> => {
  const attacks = Array.isArray(card.attacks)
    ? card.attacks.map((attack) => ({
        name: normalizeText((attack as Record<string, unknown>).name),
        cost: Array.isArray((attack as Record<string, unknown>).cost)
          ? ((attack as Record<string, unknown>).cost as unknown[]).map((x) => String(x)).sort()
          : [],
        damage: normalizeText((attack as Record<string, unknown>).damage),
        effect: normalizeText((attack as Record<string, unknown>).effect)
      }))
    : [];

  const abilities = Array.isArray(card.abilities)
    ? card.abilities.map((ability) => ({
        name: normalizeText((ability as Record<string, unknown>).name),
        type: normalizeText((ability as Record<string, unknown>).type),
        effect: normalizeText((ability as Record<string, unknown>).effect)
      }))
    : [];

  const rules = Array.isArray(card.rules)
    ? (card.rules as unknown[]).map((rule) => normalizeText(rule)).filter(Boolean)
    : [];

  return {
    name: normalizeText(card.name),
    category: normalizeText(card.category),
    hp: Number(card.hp ?? 0) || 0,
    stage: normalizeText((card as Record<string, unknown>).stage),
    types: (card.types ?? []).map((type) => String(type)).sort(),
    abilities,
    attacks,
    rules,
    effect: normalizeText((card as Record<string, unknown>).effect),
    description: normalizeText((card as Record<string, unknown>).description)
  };
};

const buildLogicalId = (card: CardDetail): string => {
  const signature = buildLogicalSignature(card);
  return sha1(signature).slice(0, 24);
};

const sqlString = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
};

const runCommand = (cmd: string, cmdArgs: string[], quiet = false): Promise<string> => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (!quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (!quiet) process.stderr.write(d);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else {
        const redactedArgs: string[] = [];
        for (let i = 0; i < cmdArgs.length; i += 1) {
          const arg = cmdArgs[i];
          if (arg === "--command") {
            redactedArgs.push("--command", "<redacted-sql>");
            i += 1;
            continue;
          }
          redactedArgs.push(arg);
        }
        const details = (stderr || stdout || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000);
        reject(new Error(`${cmd} ${redactedArgs.join(" ")} failed: ${details}`));
      }
    });
  });
};

const summarizeError = (error: unknown, maxLength = 1200): string => {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
};

const extractJson = (output: string): unknown => {
  const startIdx = Math.min(
    ...[output.indexOf("["), output.indexOf("{")].filter((x) => x >= 0)
  );
  if (!Number.isFinite(startIdx)) {
    throw new Error(`无法解析 JSON 输出: ${output}`);
  }
  const jsonRaw = output.slice(startIdx);
  return JSON.parse(jsonRaw);
};

const d1Query = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
  const output = await runCommand(
    "wrangler",
    ["d1", "execute", d1DatabaseName, "--remote", "--json", "--command", sql],
    true
  );

  const parsed = extractJson(output) as Array<{ results?: T[] }>;
  return parsed?.[0]?.results ?? [];
};

const d1Execute = async (sql: string): Promise<void> => {
  await runCommand("wrangler", ["d1", "execute", d1DatabaseName, "--remote", "--command", sql], true);
};

const ensureSyncTables = async (): Promise<void> => {
  await d1Execute(`
    CREATE TABLE IF NOT EXISTS synced_images (
      object_key TEXT PRIMARY KEY,
      lang TEXT NOT NULL,
      card_id TEXT NOT NULL,
      set_id TEXT NOT NULL,
      quality TEXT NOT NULL,
      ext TEXT NOT NULL,
      source_image_base TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_synced_images_lang_card
      ON synced_images(lang, card_id);
  `);
};

const kvPut = async (key: string, value: string): Promise<void> => {
  await runCommand(
    "wrangler",
    ["kv", "key", "put", "--namespace-id", kvNamespaceId, key, value],
    true
  );
};

const r2Put = async (objectKey: string, filePath: string): Promise<void> => {
  const body = await readFile(filePath);
  await r2S3Request("PUT", objectKey, body);
};

const r2Get = async (objectKey: string, filePath: string): Promise<void> => {
  const bytes = await r2S3Request("GET", objectKey);
  await writeFile(filePath, new Uint8Array(bytes));
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ptcg-dex-sync/0.1"
    }
  });
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status} ${url}`);
  }
  return (await res.json()) as T;
};

const fetchArrayBuffer = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ptcg-dex-sync/0.1"
    }
  });
  if (!res.ok) throw new Error(`下载图片失败 ${res.status} ${url}`);
  return await res.arrayBuffer();
};

const checkPublicObject = async (url: string): Promise<number> => {
  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      "user-agent": "ptcg-dex-sync/0.1"
    }
  });
  return res.status;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const createProgressLogger = (
  lang: Lang,
  stage: ProgressStage,
  total: number,
  interval = 200
) => {
  if (total <= 0) {
    return (_done: number, _extra?: string) => {};
  }

  let lastLogged = 0;
  return (done: number, extra?: string) => {
    if (done < total && done - lastLogged < interval) return;
    lastLogged = done;
    const percent = ((done / total) * 100).toFixed(1);
    const suffix = extra ? ` | ${extra}` : "";
    console.log(`[${lang}] ${stage} 进度 ${done}/${total} (${percent}%)${suffix}`);
  };
};

const parallelMap = async <T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 8,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> => {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      output[idx] = await worker(items[idx], idx);
      done += 1;
      onProgress?.(done, items.length);
    }
  });

  await Promise.all(runners);
  return output;
};

const executeStatementsInChunks = async (statements: string[]): Promise<void> => {
  let pending: string[] = [];
  let currentLength = 0;

  const flush = async () => {
    if (pending.length === 0) return;
    await d1Execute(pending.join("\n"));
    pending = [];
    currentLength = 0;
  };

  for (const raw of statements) {
    const statement = raw.trim();
    if (!statement) continue;
    const size = statement.length + 1;

    if (size > MAX_D1_SQL_CHARS) {
      throw new Error(`SQL 语句长度超过限制（${size} > ${MAX_D1_SQL_CHARS}）`);
    }

    if (currentLength + size > MAX_D1_SQL_CHARS && pending.length > 0) {
      await flush();
    }

    pending.push(statement);
    currentLength += size;
  }

  await flush();
};

const saveFilters = async (lang: Lang): Promise<number> => {
  const [typesRows, raritiesRows, categoriesRows, regulationRows, stageRows, trainerTypeRows, energyTypeRows, illustratorsRows, hpRows, setRows] = await Promise.all([
    d1Query<{ value: string }>(
      `SELECT DISTINCT type as value FROM card_types WHERE lang = ${sqlString(lang)} ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT rarity as value
       FROM cards
       WHERE lang = ${sqlString(lang)} AND rarity IS NOT NULL AND rarity != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT category as value
       FROM cards
       WHERE lang = ${sqlString(lang)} AND category IS NOT NULL AND category != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT json_extract(payload, '$.regulationMark') as value
       FROM cards
       WHERE lang = ${sqlString(lang)}
         AND json_extract(payload, '$.regulationMark') IS NOT NULL
         AND json_extract(payload, '$.regulationMark') != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT json_extract(payload, '$.stage') as value
       FROM cards
       WHERE lang = ${sqlString(lang)}
         AND json_extract(payload, '$.stage') IS NOT NULL
         AND json_extract(payload, '$.stage') != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT json_extract(payload, '$.trainerType') as value
       FROM cards
       WHERE lang = ${sqlString(lang)}
         AND json_extract(payload, '$.trainerType') IS NOT NULL
         AND json_extract(payload, '$.trainerType') != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT json_extract(payload, '$.energyType') as value
       FROM cards
       WHERE lang = ${sqlString(lang)}
         AND json_extract(payload, '$.energyType') IS NOT NULL
         AND json_extract(payload, '$.energyType') != ''
       ORDER BY value;`
    ),
    d1Query<{ value: string }>(
      `SELECT DISTINCT illustrator as value
       FROM cards
       WHERE lang = ${sqlString(lang)} AND illustrator IS NOT NULL AND illustrator != ''
       ORDER BY value;`
    ),
    d1Query<{ value: number | string }>(
      `SELECT DISTINCT hp as value
       FROM cards
       WHERE lang = ${sqlString(lang)} AND hp IS NOT NULL
       ORDER BY value;`
    ),
    d1Query<{ id: string; name: string }>(
      `SELECT DISTINCT set_id as id, set_name as name
       FROM cards
       WHERE lang = ${sqlString(lang)} AND set_id IS NOT NULL AND set_id != ''
       ORDER BY name;`
    )
  ]);

  const types = typesRows.map((x) => String(x.value)).filter(Boolean);
  const rarities = raritiesRows.map((x) => String(x.value)).filter(Boolean);
  const categories = categoriesRows.map((x) => String(x.value)).filter(Boolean);
  const regulationMarks = regulationRows.map((x) => String(x.value)).filter(Boolean);
  const stages = stageRows.map((x) => String(x.value)).filter(Boolean);
  const trainerTypes = trainerTypeRows.map((x) => String(x.value)).filter(Boolean);
  const energyTypes = energyTypeRows.map((x) => String(x.value)).filter(Boolean);
  const illustrators = illustratorsRows.map((x) => String(x.value)).filter(Boolean);
  const hp = hpRows
    .map((x) => Number(x.value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const sets = setRows
    .map((x) => ({ id: String(x.id), name: String(x.name ?? x.id) }))
    .filter((x) => x.id);

  const statements: string[] = [`DELETE FROM filters WHERE lang = ${sqlString(lang)};`];

  for (const value of types) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(lang)}, 'type', ${sqlString(
        value
      )}, 0);`
    );
  }
  for (const value of rarities) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'rarity', ${sqlString(value)}, 0);`
    );
  }
  for (const value of categories) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'category', ${sqlString(value)}, 0);`
    );
  }
  for (const value of regulationMarks) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'regulationMark', ${sqlString(value)}, 0);`
    );
  }
  for (const value of stages) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'stage', ${sqlString(value)}, 0);`
    );
  }
  for (const value of trainerTypes) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'trainerType', ${sqlString(value)}, 0);`
    );
  }
  for (const value of energyTypes) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'energyType', ${sqlString(value)}, 0);`
    );
  }
  for (const value of illustrators) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(
        lang
      )}, 'illustrator', ${sqlString(value)}, 0);`
    );
  }
  for (const value of hp) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(lang)}, 'hp', ${sqlString(
        value
      )}, 0);`
    );
  }
  for (const value of sets) {
    statements.push(
      `INSERT OR REPLACE INTO filters(lang, kind, value, count) VALUES(${sqlString(lang)}, 'set', ${sqlString(
        `${value.id}|${value.name ?? value.id}`
      )}, 0);`
    );
  }

  if (!dryRun) {
    await executeStatementsInChunks(statements);
    await kvPut(
      `filters:${lang}`,
      JSON.stringify({
        lang,
        types,
        rarities,
        categories,
        regulationMarks,
        stages,
        trainerTypes,
        energyTypes,
        illustrators,
        hp,
        sets
      })
    );
  }

  return (
    types.length +
    rarities.length +
    categories.length +
    regulationMarks.length +
    stages.length +
    trainerTypes.length +
    energyTypes.length +
    illustrators.length +
    hp.length +
    sets.length
  );
};

const loadExistingHashes = async (lang: Lang): Promise<Map<string, string>> => {
  const rows = await d1Query<{ id: string; source_hash: string }>(
    `SELECT id, source_hash FROM source_hashes WHERE lang = ${sqlString(lang)};`
  );
  return new Map(rows.map((x) => [x.id, x.source_hash]));
};

const loadSyncedImageKeys = async (lang: Lang): Promise<Set<string>> => {
  const rows = await d1Query<{ object_key: string }>(
    `SELECT object_key FROM synced_images WHERE lang = ${sqlString(lang)};`
  );
  return new Set(rows.map((x) => x.object_key));
};

const upsertSyncedImageKey = async (
  lang: Lang,
  cardId: string,
  setId: string,
  quality: "low" | "high",
  ext: "webp" | "png",
  objectKey: string,
  sourceImageBase?: string
): Promise<void> => {
  await d1Execute(`
    INSERT OR REPLACE INTO synced_images (
      object_key, lang, card_id, set_id, quality, ext, source_image_base, updated_at
    ) VALUES (
      ${sqlString(objectKey)},
      ${sqlString(lang)},
      ${sqlString(cardId)},
      ${sqlString(setId)},
      ${sqlString(quality)},
      ${sqlString(ext)},
      ${sqlString(sourceImageBase ?? null)},
      CURRENT_TIMESTAMP
    );
  `);
};

const runSqlBlocksInBatches = async (
  blocks: Array<{ id?: string; sql: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<void> => {
  const total = blocks.length;
  let done = 0;

  const flush = async (batch: string[]) => {
    if (batch.length === 0) return;
    // Cloudflare D1 remote execute does not allow explicit BEGIN/COMMIT.
    // We send multi-statement SQL blocks directly and control size here.
    await d1Execute(batch.join("\n"));
    done += batch.length;
    onProgress?.(done, total);
  };

  let pending: string[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const sql = block.sql.trim();
    const blockLength = sql.length + 1;

    if (blockLength > MAX_D1_SQL_CHARS) {
      throw new Error(
        `卡牌写入 SQL 过长（lang block: ${block.id ?? "unknown"}，长度 ${blockLength}，上限 ${MAX_D1_SQL_CHARS}）`
      );
    }

    if (currentLength + blockLength > MAX_D1_SQL_CHARS && pending.length > 0) {
      await flush(pending);
      pending = [];
      currentLength = 0;
    }

    pending.push(sql);
    currentLength += blockLength;
  }

  await flush(pending);
};

const upsertCards = async (lang: Lang, cards: CardDetail[]): Promise<void> => {
  const blocks: Array<{ id: string; sql: string }> = [];

  for (const card of cards) {
    const id = card.id;
    const setId = card.set?.id ?? null;
    const setName = card.set?.name ?? null;
    const hp = card.hp ? Number(card.hp) : null;
    const sourceHash = sha1(card);
    const payload = stableStringify(card);

    const statements: string[] = [];

    statements.push(
      `DELETE FROM card_types WHERE lang = ${sqlString(lang)} AND card_id = ${sqlString(id)};`
    );

    statements.push(`
INSERT OR REPLACE INTO cards (
  lang, id, local_id, logical_id, name, name_zh_cn, category, rarity, set_id, set_name, illustrator, hp, has_image, image_base, payload, source_hash, updated_at
) VALUES (
  ${sqlString(lang)},
  ${sqlString(id)},
  ${sqlString(card.localId ?? null)},
  ${sqlString(buildLogicalId(card))},
  ${sqlString(card.name ?? id)},
  ${sqlString(toSearchNameZhCn(lang, card.name ?? id))},
  ${sqlString(card.category ?? null)},
  ${sqlString(card.rarity ?? null)},
  ${sqlString(setId)},
  ${sqlString(setName)},
  ${sqlString(card.illustrator ?? null)},
  ${sqlString(hp)},
  ${card.image ? "1" : "0"},
  ${sqlString(card.image ?? null)},
  ${sqlString(payload)},
  ${sqlString(sourceHash)},
  CURRENT_TIMESTAMP
);
    `.trim());

    statements.push(`
INSERT OR REPLACE INTO source_hashes(lang, id, source_hash, payload_updated_at)
VALUES(${sqlString(lang)}, ${sqlString(id)}, ${sqlString(sourceHash)}, CURRENT_TIMESTAMP);
    `.trim());

    for (const type of card.types ?? []) {
      statements.push(
        `INSERT OR REPLACE INTO card_types(lang, card_id, type) VALUES(${sqlString(lang)}, ${sqlString(
          id
        )}, ${sqlString(type)});`
      );
    }

    blocks.push({
      id: `${lang}/${id}`,
      sql: statements.join("\n")
    });
  }

  if (!dryRun) {
    const logProgress = createProgressLogger(lang, "d1", blocks.length, 150);
    await runSqlBlocksInBatches(blocks, (done, total) => {
      logProgress(done, `已写入 ${done} / ${total}`);
    });
  }
};

const uploadCardImages = async (
  lang: Lang,
  cards: CardDetail[]
): Promise<{ uploaded: number; skipped: number }> => {
  if (!withImages) return { uploaded: 0, skipped: 0 };

  const tempDir = await mkdtemp(join(tmpdir(), "ptcg-dex-sync-"));
  let uploaded = 0;
  let skipped = 0;
  let checked = 0;
  let firstUploadedKey: string | undefined;
  const cardsWithImage = cards.filter((card) => Boolean(card.image && card.set?.id && card.id));
  const totalCandidates = cardsWithImage.length * 4;
  const logProgress = createProgressLogger(lang, "images", totalCandidates, 25);
  const syncedKeys = dryRun ? new Set<string>() : await loadSyncedImageKeys(lang);
  console.log(
    `[${lang}] images 阶段开始：目标桶=${r2BucketName}，候选 ${totalCandidates}（卡牌 ${cardsWithImage.length}），已索引可跳过 ${syncedKeys.size}`
  );

  const heartbeat = setInterval(() => {
    const percent = totalCandidates > 0 ? ((checked / totalCandidates) * 100).toFixed(1) : "100.0";
    console.log(
      `[${lang}] images 心跳 ${checked}/${totalCandidates} (${percent}%) | 上传 ${uploaded} | 跳过 ${skipped}`
    );
  }, 15000);

  try {
    for (const card of cardsWithImage) {
      const setId = card.set?.id;
      if (!card.image || !setId || !card.id) continue;

      for (const quality of ["low", "high"] as const) {
        for (const ext of ["webp", "png"] as const) {
          const sourceUrl = `${card.image}/${quality}.${ext}`;
          const objectKey = `cards/${lang}/${setId}/${card.id}/${quality}.${ext}`;
          const filePath = join(tempDir, `${lang}-${setId}-${card.id}-${quality}.${ext}`.replace(/\//g, "_"));

          if (syncedKeys.has(objectKey)) {
            skipped += 1;
            checked += 1;
            logProgress(checked, `上传 ${uploaded} | 跳过 ${skipped}`);
            continue;
          }

          try {
            const buffer = await fetchArrayBuffer(sourceUrl);
            await writeFile(filePath, new Uint8Array(buffer));
            if (!dryRun) {
              await r2Put(objectKey, filePath);
              await upsertSyncedImageKey(lang, card.id, setId, quality, ext, objectKey, card.image);
              syncedKeys.add(objectKey);
              if (!firstUploadedKey) {
                firstUploadedKey = objectKey;
                const publicHint = r2PublicBaseUrl ? `${r2PublicBaseUrl}/${objectKey}` : "";
                console.log(
                  `[${lang}] images 首个上传对象: ${objectKey}${publicHint ? ` | 访问地址: ${publicHint}` : ""}`
                );
              }
            }
            uploaded += 1;
            checked += 1;
            logProgress(checked, `上传 ${uploaded} | 跳过 ${skipped}`);
          } catch (error) {
            console.warn(`图片同步失败 ${sourceUrl}: ${(error as Error).message}`);
            checked += 1;
            logProgress(checked, `上传 ${uploaded} | 跳过 ${skipped}`);
          }
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
    await rm(tempDir, { recursive: true, force: true });
  }

  if (!dryRun && firstUploadedKey) {
    const verifyFile = join(tmpdir(), `ptcg-dex-r2-verify-${Date.now()}.tmp`);
    try {
      await r2Get(firstUploadedKey, verifyFile);
      console.log(`[${lang}] images 抽样校验成功：${firstUploadedKey} 可读取`);
    } catch (error) {
      console.warn(
        `[${lang}] images 抽样校验失败：${firstUploadedKey} 读取失败，可能是账号/桶不一致。${summarizeError(error, 280)}`
      );
    } finally {
      await rm(verifyFile, { force: true });
    }

    if (r2PublicBaseUrl) {
      const publicUrl = `${r2PublicBaseUrl}/${firstUploadedKey}`;
      try {
        const status = await checkPublicObject(publicUrl);
        if (status >= 200 && status < 400) {
          console.log(`[${lang}] images 公网域名校验成功：${publicUrl} -> ${status}`);
        } else {
          console.warn(
            `[${lang}] images 公网域名校验异常：${publicUrl} -> ${status}（可能是域名未绑定当前桶，或对象尚未可见）`
          );
        }
      } catch (error) {
        console.warn(
          `[${lang}] images 公网域名校验失败：${publicUrl} -> ${summarizeError(error, 280)}`
        );
      }
    }
  }

  console.log(
    `[${lang}] images 阶段完成：总处理 ${checked}/${totalCandidates} | 上传 ${uploaded} | 跳过 ${skipped}`
  );

  return { uploaded, skipped };
};

const fetchCardList = async (lang: Lang): Promise<CardListItem[]> => {
  if (targetRegulationMarks.length === 0) {
    return await fetchJson<CardListItem[]>(`${tcgdexBase}/${lang}/cards`);
  }

  const byId = new Map<string, CardListItem>();
  for (const mark of targetRegulationMarks) {
    const listUrl = new URL(`${tcgdexBase}/${lang}/cards`);
    listUrl.searchParams.set("regulationMark", `eq:${mark}`);
    const list = await fetchJson<CardListItem[]>(listUrl.toString());
    for (const item of list) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
};

const hasTargetRegulationMark = (card: CardDetail): boolean => {
  if (targetRegulationMarks.length === 0) return true;
  const mark = String(card.regulationMark ?? "")
    .trim()
    .toUpperCase();
  return targetRegulationMarks.includes(mark);
};

const syncLang = async (lang: Lang, runType: "full" | "incremental") => {
  console.log(`\n=== 同步语言 ${lang} (${runType}) ===`);

  const list = await fetchCardList(lang);
  const existing = runType === "incremental" ? await loadExistingHashes(lang) : new Map<string, string>();

  const changedCandidates = list.filter((item) => {
    if (runType === "full") return true;
    const candidateHash = sha1(item);
    return existing.get(item.id) !== candidateHash;
  });

  const skippedByHash = list.length - changedCandidates.length;
  console.log(
    `语言 ${lang} 总计 ${list.length}，需要更新 ${changedCandidates.length}，哈希跳过 ${skippedByHash}${
      targetRegulationMarks.length > 0 ? `，规则标识=${targetRegulationMarks.join(",")}` : ""
    }`
  );

  const logDetailProgress = createProgressLogger(lang, "details", changedCandidates.length, 250);
  const details = await parallelMap(
    changedCandidates,
    async (item) => {
      try {
        return await fetchJson<CardDetail>(`${tcgdexBase}/${lang}/cards/${encodeURIComponent(item.id)}`);
      } catch (error) {
        console.warn(`卡牌详情拉取失败 ${lang}/${item.id}: ${(error as Error).message}`);
        return null;
      }
    },
    8,
    (done, total) => {
      logDetailProgress(done, `已拉取 ${done} / ${total}`);
    }
  );

  const validCards = details.filter((x): x is CardDetail => {
    if (!x?.id) return false;
    return hasTargetRegulationMark(x);
  });

  await upsertCards(lang, validCards);
  const imageStats = await uploadCardImages(lang, validCards);
  const filtersUpdated = await saveFilters(lang);

  console.log(
    `[${lang}] 完成：卡片写入 ${validCards.length}，图片上传 ${imageStats.uploaded}，图片跳过 ${imageStats.skipped}，过滤器更新 ${filtersUpdated}`
  );

  return {
    scanned: list.length,
    changed: changedCandidates.length,
    upserted: validCards.length,
    imagesUploaded: imageStats.uploaded,
    imagesSkipped: imageStats.skipped,
    filtersUpdated
  };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const runType = mode;
  console.log(
    `同步配置: mode=${runType}, langs=${targetLangs.join(",")}, regulationMarks=${targetRegulationMarks.length > 0 ? targetRegulationMarks.join(",") : "ALL"}, images=${withImages ? "on" : "off"}, dryRun=${dryRun ? "on" : "off"}`
  );

  if (!dryRun) {
    await ensureSyncTables();
    await d1Execute(`
      INSERT INTO sync_runs(run_type, status, summary_json, started_at, finished_at)
      VALUES(${sqlString(runType)}, 'running', NULL, CURRENT_TIMESTAMP, NULL);
    `);
  }

  const langs = targetLangs;
  const summary: SyncSummary = {
    runType,
    startedAt,
    finishedAt: startedAt,
    langs: {
      "zh-tw": {
        scanned: 0,
        changed: 0,
        upserted: 0,
        imagesUploaded: 0,
        imagesSkipped: 0,
        filtersUpdated: 0
      }
    }
  };

  for (const lang of langs) {
    summary.langs[lang] = await syncLang(lang, runType);
  }

  summary.finishedAt = new Date().toISOString();

  const summaryText = JSON.stringify(summary);
  console.log(`\n同步摘要: ${summaryText}`);

  if (!dryRun) {
    await d1Execute(`
      UPDATE sync_runs
      SET status = 'success', summary_json = ${sqlString(summaryText)}, finished_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT MAX(id) FROM sync_runs);
    `);

    await kvPut("sync:latest", summaryText);
  }
};

main().catch(async (error) => {
  console.error("同步失败:", error);
  try {
    if (!dryRun) {
      const errorSummary = summarizeError(error, 900);
      await d1Execute(`
        UPDATE sync_runs
        SET status = 'failed', summary_json = ${sqlString(
          JSON.stringify({ error: errorSummary })
        )}, finished_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT MAX(id) FROM sync_runs);
      `);
    }
  } catch (writeError) {
    console.error("写入失败状态也失败:", writeError);
  }
  process.exit(1);
});
