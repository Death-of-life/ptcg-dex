import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const openapiPath = new URL("../../openapi/openapi.yaml", import.meta.url);
const workerPath = new URL("../../apps/worker/src/index.ts", import.meta.url);

const openapi = yaml.load(readFileSync(openapiPath, "utf8"));
const workerSource = readFileSync(workerPath, "utf8");

const requiredPaths = ["/health", "/v1/{lang}/cards", "/v1/{lang}/cards/{id}", "/v1/{lang}/filters"];
const missingOpenapi = requiredPaths.filter((p) => !(openapi.paths && p in openapi.paths));

const requiredWorkerSnippets = [
  'registerApiRoutes("/v1")',
  'registerApiRoutes("/api")',
  '${prefix}/:lang/cards',
  '${prefix}/:lang/cards/:id',
  '${prefix}/:lang/filters',
  'app.get("/health"'
];

const missingWorker = requiredWorkerSnippets.filter((s) => !workerSource.includes(s));

if (missingOpenapi.length || missingWorker.length) {
  console.error("检测到 API 文档与路由可能漂移");
  if (missingOpenapi.length) {
    console.error("OpenAPI 缺失路径:", missingOpenapi.join(", "));
  }
  if (missingWorker.length) {
    console.error("Worker 缺失代码片段:", missingWorker.join(", "));
  }
  process.exit(1);
}

console.log("API 路由与 OpenAPI 基础对齐检查通过");
