# TCGdex Atlas

基于 Cloudflare 全家桶构建的三语言 Pokemon 图鉴站：`en`、`ja`、`zh-tw`。

- 前端：Next.js（Cloudflare Pages）
- 后端：Cloudflare Workers
- 数据：D1（主查询）+ KV（缓存）+ R2（全量卡图）
- 同步：GitHub Actions（首次全量 + 每日增量）
- API 文档：OpenAPI + Swagger + ReDoc

## 架构

```text
TCGdex API
   ↓ (GitHub Actions 同步)
D1 (cards / filters / source_hashes / sync_runs)
KV (filters + 热点缓存)
R2 (low/high + webp/png)
   ↓
Workers API (/v1)
   ↓
Pages (Next.js Web)
```

## 快速开始

### 1) 安装依赖

```bash
npm ci
```

### 2) 初始化 Cloudflare 资源

1. 创建 D1：`ptcg-dex-db`
2. 创建 KV namespace
3. 创建 R2 bucket：`ptcg-dex-card-images`
4. 配置 R2 公网域名（CDN）
5. 创建 Worker 与 Pages 项目
6. 把资源 ID/名称写入 `apps/worker/wrangler.toml`

### 3) 迁移数据库

```bash
npx wrangler d1 migrations apply ptcg-dex-db --local --config apps/worker/wrangler.toml
# 生产：
# npx wrangler d1 migrations apply ptcg-dex-db --remote --config apps/worker/wrangler.toml
```

### 4) 本地启动

```bash
# API
npm run dev:worker

# Web
npm run dev:web
```

默认 API 为 `http://127.0.0.1:8787`，前端读取 `NEXT_PUBLIC_API_BASE_URL`。

## GitHub Secrets 配置

以下 Secret 为必需：

- `CLOUDFLARE_API_TOKEN`: Cloudflare 全局 Token（后续建议拆最小权限）
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 账号 ID
- `CF_R2_PUBLIC_BASE_URL`: R2 对外加速域名，例如 `https://img.example.com`
- `D1_DATABASE_NAME`: D1 数据库名（如 `ptcg-dex-db`）
- `KV_NAMESPACE_ID`: KV namespace ID
- `R2_BUCKET_NAME`: R2 bucket 名（如 `ptcg-dex-card-images`）
- `TCGDEX_BASE_URL`: 可选，默认 `https://api.tcgdex.net/v2`
- `CF_PAGES_PROJECT_NAME`: Pages 项目名（用于 deploy workflow）

## 同步流程说明

### 首次全量同步

通过 GitHub Actions 手动触发 `Sync TCGdex Data`，选择 `mode=full`。

流程：

1. 拉取三语言卡列表
2. 获取卡详情并写入 D1
3. 全量上传卡图到 R2（`low/high + webp/png`）
4. 生成并写入语言过滤器到 D1 + KV
5. 记录 `sync_runs` 与 `sync:latest`

### 每日增量同步

- `sync-tcgdex.yml` 每天自动运行（UTC 02:00）
- 通过 `source_hashes` 检测变化，默认只更新变更卡和对应图片

### 失败重跑

1. 打开 `Actions -> Sync TCGdex Data`
2. `Run workflow`
3. 先尝试 `incremental`
4. 若数据异常再执行 `full`

## 部署流程

`deploy.yml` 在 `main` 分支 push 或手动触发时执行：

1. OpenAPI lint
2. API 路由漂移检查（OpenAPI vs Worker 路由）
3. 构建 Web
4. 部署 Worker
5. 部署 Pages（静态导出目录 `apps/web/out`）

## API 文档入口

OpenAPI 源文件：`openapi/openapi.yaml`

- Swagger: `/docs/swagger`
- ReDoc: `/docs/redoc`

文档覆盖：

- 所有接口参数与返回 schema
- 语言约束与错误示例
- 分页排序与筛选说明
- 缓存与版本策略（`/v1`）

## 可用 API

- `GET /health`
- `GET /v1/{lang}/cards`
- `GET /v1/{lang}/cards/{id}`
- `GET /v1/{lang}/filters`

兼容路径：`/api/{lang}/...`（与 `/v1/{lang}/...` 行为一致）

## 环境变量（前端）

- `NEXT_PUBLIC_API_BASE_URL`: Worker API 根地址
- `NEXT_PUBLIC_R2_IMAGE_HOST`: 可选，仅用于 Next Image 远程域白名单

## 验收清单

- 三语言查询互不串数据
- 筛选器按语言独立
- 卡图使用 R2 域名可访问
- 手机端底部筛选抽屉可用
- OpenAPI lint 通过，Swagger/ReDoc 可访问

## 本地质量检查

```bash
npm run test
npm run typecheck
npm run openapi:lint
npm run api:drift
```

## 安全建议（后续）

当前使用全局 Token 可快速落地。上线后建议改为最小权限 Token：

- Workers Scripts: Edit
- Workers KV Storage: Edit
- D1: Edit
- R2: Edit
- Pages: Edit
