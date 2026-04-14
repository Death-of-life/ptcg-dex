import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), "apps/worker/wrangler.toml");
const input = readFileSync(configPath, "utf8");

const required = [
  "D1_DATABASE_NAME",
  "D1_DATABASE_ID",
  "KV_NAMESPACE_ID",
  "R2_BUCKET_NAME",
  "CF_R2_PUBLIC_BASE_URL"
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`缺少渲染 wrangler.toml 所需环境变量: ${missing.join(", ")}`);
  process.exit(1);
}

const normalizePublicUrl = (value) => {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

const normalizedR2PublicBaseUrl = normalizePublicUrl(process.env.CF_R2_PUBLIC_BASE_URL);

const rendered = input
  .replaceAll("__CLOUDFLARE_ACCOUNT_ID__", process.env.CLOUDFLARE_ACCOUNT_ID ?? "")
  .replaceAll("__D1_DATABASE_NAME__", process.env.D1_DATABASE_NAME)
  .replaceAll("__D1_DATABASE_ID__", process.env.D1_DATABASE_ID)
  .replaceAll("__KV_NAMESPACE_ID__", process.env.KV_NAMESPACE_ID)
  .replaceAll("__R2_BUCKET_NAME__", process.env.R2_BUCKET_NAME)
  .replaceAll("__R2_PUBLIC_BASE_URL__", normalizedR2PublicBaseUrl);

const normalized = rendered.replace(/^account_id = ""\n/m, "");

writeFileSync(configPath, normalized);
console.log("wrangler.toml 已根据 Secrets 渲染完成");
