export default function DocsHome() {
  return (
    <main style={{ padding: 24, fontFamily: "var(--font-body)" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", marginBottom: 12 }}>API 文档中心</h1>
      <p>你可以选择交互式 Swagger 或结构化 ReDoc 浏览接口。</p>
      <ul>
        <li>
          <a href="/docs/swagger" target="_blank" rel="noreferrer">
            Swagger UI
          </a>
        </li>
        <li>
          <a href="/docs/redoc" target="_blank" rel="noreferrer">
            ReDoc
          </a>
        </li>
      </ul>
    </main>
  );
}
