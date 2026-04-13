import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const SUPPORTED_LANGS = ["en", "ja", "zh-tw"] as const;
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
  langs: Record<
    Lang,
    {
      scanned: number;
      changed: number;
      upserted: number;
      imagesUploaded: number;
      filtersUpdated: number;
    }
  >;
};

const args = new Set(process.argv.slice(2));
const mode = args.has("--full") ? "full" : "incremental";
const dryRun = args.has("--dry-run");
const withImages = !args.has("--no-images");
const MAX_D1_SQL_CHARS = Number(process.env.D1_MAX_SQL_CHARS ?? "50000");

const tcgdexBase = ((process.env.TCGDEX_BASE_URL ?? "").trim() || "https://api.tcgdex.net/v2").replace(
  /\/+$/,
  ""
);
const d1DatabaseName = process.env.D1_DATABASE_NAME;
const kvNamespaceId = process.env.KV_NAMESPACE_ID;
const r2BucketName = process.env.R2_BUCKET_NAME;

if (!d1DatabaseName || !kvNamespaceId || !r2BucketName) {
  console.error(
    "缺少环境变量: D1_DATABASE_NAME, KV_NAMESPACE_ID, R2_BUCKET_NAME（需要在 GitHub Secrets 或环境中提供）"
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

const kvPut = async (key: string, value: string): Promise<void> => {
  await runCommand(
    "wrangler",
    ["kv", "key", "put", "--namespace-id", kvNamespaceId, key, value],
    true
  );
};

const r2Put = async (objectKey: string, filePath: string): Promise<void> => {
  await runCommand(
    "wrangler",
    ["r2", "object", "put", `${r2BucketName}/${objectKey}`, "--file", filePath],
    true
  );
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

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const parallelMap = async <T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 8
): Promise<R[]> => {
  const output: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      output[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(runners);
  return output;
};

const saveFilters = async (lang: Lang): Promise<number> => {
  const [types, rarities, illustrators, hp, sets] = await Promise.all([
    fetchJson<string[]>(`${tcgdexBase}/${lang}/types`),
    fetchJson<string[]>(`${tcgdexBase}/${lang}/rarities`),
    fetchJson<string[]>(`${tcgdexBase}/${lang}/illustrators`),
    fetchJson<number[]>(`${tcgdexBase}/${lang}/hp`),
    fetchJson<Array<{ id: string; name: string }>>(`${tcgdexBase}/${lang}/sets`)
  ]);

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
    await d1Execute(statements.join("\n"));
    await kvPut(
      `filters:${lang}`,
      JSON.stringify({
        lang,
        types,
        rarities,
        illustrators,
        hp,
        sets
      })
    );
  }

  return types.length + rarities.length + illustrators.length + hp.length + sets.length;
};

const loadExistingHashes = async (lang: Lang): Promise<Map<string, string>> => {
  const rows = await d1Query<{ id: string; source_hash: string }>(
    `SELECT id, source_hash FROM source_hashes WHERE lang = ${sqlString(lang)};`
  );
  return new Map(rows.map((x) => [x.id, x.source_hash]));
};

const runSqlBlocksInBatches = async (
  blocks: Array<{ id?: string; sql: string }>
): Promise<void> => {
  const flush = async (batch: string[]) => {
    if (batch.length === 0) return;
    await d1Execute(`BEGIN;\n${batch.join("\n")}\nCOMMIT;`);
  };

  let pending: string[] = [];
  let currentLength = "BEGIN;\nCOMMIT;".length;

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
      currentLength = "BEGIN;\nCOMMIT;".length;
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
  lang, id, local_id, name, category, rarity, set_id, set_name, illustrator, hp, image_base, payload, source_hash, updated_at
) VALUES (
  ${sqlString(lang)},
  ${sqlString(id)},
  ${sqlString(card.localId ?? null)},
  ${sqlString(card.name ?? id)},
  ${sqlString(card.category ?? null)},
  ${sqlString(card.rarity ?? null)},
  ${sqlString(setId)},
  ${sqlString(setName)},
  ${sqlString(card.illustrator ?? null)},
  ${sqlString(hp)},
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
    await runSqlBlocksInBatches(blocks);
  }
};

const uploadCardImages = async (lang: Lang, cards: CardDetail[]): Promise<number> => {
  if (!withImages) return 0;

  const tempDir = await mkdtemp(join(tmpdir(), "ptcg-dex-sync-"));
  let uploaded = 0;

  try {
    for (const card of cards) {
      const setId = card.set?.id;
      if (!card.image || !setId || !card.id) continue;

      for (const quality of ["low", "high"] as const) {
        for (const ext of ["webp", "png"] as const) {
          const sourceUrl = `${card.image}/${quality}.${ext}`;
          const objectKey = `cards/${lang}/${setId}/${card.id}/${quality}.${ext}`;
          const filePath = join(tempDir, `${lang}-${setId}-${card.id}-${quality}.${ext}`.replace(/\//g, "_"));

          try {
            const buffer = await fetchArrayBuffer(sourceUrl);
            await writeFile(filePath, new Uint8Array(buffer));
            if (!dryRun) {
              await r2Put(objectKey, filePath);
            }
            uploaded += 1;
          } catch (error) {
            console.warn(`图片同步失败 ${sourceUrl}: ${(error as Error).message}`);
          }
        }
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return uploaded;
};

const syncLang = async (lang: Lang, runType: "full" | "incremental") => {
  console.log(`\n=== 同步语言 ${lang} (${runType}) ===`);

  const list = await fetchJson<CardListItem[]>(`${tcgdexBase}/${lang}/cards`);
  const existing = runType === "incremental" ? await loadExistingHashes(lang) : new Map<string, string>();

  const changedCandidates = list.filter((item) => {
    if (runType === "full") return true;
    const candidateHash = sha1(item);
    return existing.get(item.id) !== candidateHash;
  });

  console.log(`语言 ${lang} 总计 ${list.length}，需要更新 ${changedCandidates.length}`);

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
    8
  );

  const validCards = details.filter((x): x is CardDetail => Boolean(x?.id));

  await upsertCards(lang, validCards);
  const imagesUploaded = await uploadCardImages(lang, validCards);
  const filtersUpdated = await saveFilters(lang);

  return {
    scanned: list.length,
    changed: changedCandidates.length,
    upserted: validCards.length,
    imagesUploaded,
    filtersUpdated
  };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const runType = mode;

  if (!dryRun) {
    await d1Execute(`
      INSERT INTO sync_runs(run_type, status, summary_json, started_at, finished_at)
      VALUES(${sqlString(runType)}, 'running', NULL, CURRENT_TIMESTAMP, NULL);
    `);
  }

  const langs = [...SUPPORTED_LANGS] as Lang[];
  const summary: SyncSummary = {
    runType,
    startedAt,
    finishedAt: startedAt,
    langs: {
      en: { scanned: 0, changed: 0, upserted: 0, imagesUploaded: 0, filtersUpdated: 0 },
      ja: { scanned: 0, changed: 0, upserted: 0, imagesUploaded: 0, filtersUpdated: 0 },
      "zh-tw": { scanned: 0, changed: 0, upserted: 0, imagesUploaded: 0, filtersUpdated: 0 }
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
