"use client";

import Image from "next/image";
import { Filter, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchCards, fetchFilters, type CardQuery } from "./lib/api";
import { LANGS, type CardListItem, type FiltersResponse, type Lang } from "./lib/types";

type FilterState = {
  name: string;
  setId: string;
  rarity: string;
  type: string;
  hpMin: string;
  hpMax: string;
  sortBy: "name" | "hp" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
};

const defaultFilter: FilterState = {
  name: "",
  setId: "",
  rarity: "",
  type: "",
  hpMin: "",
  hpMax: "",
  sortBy: "name",
  sortOrder: "asc",
  page: 1
};

const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  ja: "日本語",
  "zh-tw": "繁體中文"
};

export default function HomePage() {
  const [lang, setLang] = useState<Lang>("en");
  const [filterByLang, setFilterByLang] = useState<Record<Lang, FilterState>>({
    en: { ...defaultFilter },
    ja: { ...defaultFilter },
    "zh-tw": { ...defaultFilter }
  });
  const [filterOptions, setFilterOptions] = useState<Partial<Record<Lang, FiltersResponse>>>({});
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const current = filterByLang[lang];

  const query = useMemo<CardQuery>(() => {
    return {
      name: current.name || undefined,
      setId: current.setId || undefined,
      rarity: current.rarity || undefined,
      type: current.type || undefined,
      hpMin: current.hpMin ? Number(current.hpMin) : undefined,
      hpMax: current.hpMax ? Number(current.hpMax) : undefined,
      sortBy: current.sortBy,
      sortOrder: current.sortOrder,
      page: current.page,
      pageSize: 24
    };
  }, [current]);

  const pageCount = Math.max(1, Math.ceil(total / 24));

  useEffect(() => {
    if (filterOptions[lang]) return;

    fetchFilters(lang)
      .then((res) => {
        setFilterOptions((prev) => ({ ...prev, [lang]: res }));
      })
      .catch((e) => {
        setError((e as Error).message);
      });
  }, [lang, filterOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      fetchCards(lang, query)
        .then((res) => {
          setCards(res.items ?? []);
          setTotal(res.total ?? 0);
        })
        .catch((e) => {
          setError((e as Error).message);
        })
        .finally(() => {
          setLoading(false);
        });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [lang, query]);

  const updateFilter = (patch: Partial<FilterState>) => {
    setFilterByLang((prev) => {
      const next = { ...prev };
      next[lang] = { ...next[lang], ...patch };
      if (Object.keys(patch).some((key) => key !== "page")) {
        next[lang].page = 1;
      }
      return next;
    });
  };

  const resetFilters = () => {
    setFilterByLang((prev) => ({ ...prev, [lang]: { ...defaultFilter } }));
  };

  const filters = filterOptions[lang];

  const filterPanel = (
    <div className="glass-panel filter-panel" role="region" aria-label="筛选器">
      <h2>筛选器</h2>
      <label>
        系列
        <select
          value={current.setId}
          onChange={(e) => updateFilter({ setId: e.target.value })}
          aria-label="按系列筛选"
        >
          <option value="">全部</option>
          {filters?.sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        稀有度
        <select
          value={current.rarity}
          onChange={(e) => updateFilter({ rarity: e.target.value })}
          aria-label="按稀有度筛选"
        >
          <option value="">全部</option>
          {filters?.rarities.map((rarity) => (
            <option key={rarity} value={rarity}>
              {rarity}
            </option>
          ))}
        </select>
      </label>
      <label>
        属性
        <select
          value={current.type}
          onChange={(e) => updateFilter({ type: e.target.value })}
          aria-label="按属性筛选"
        >
          <option value="">全部</option>
          {filters?.types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <div className="hp-range">
        <label>
          HP 最低
          <input
            value={current.hpMin}
            onChange={(e) => updateFilter({ hpMin: e.target.value })}
            inputMode="numeric"
            placeholder="0"
          />
        </label>
        <label>
          HP 最高
          <input
            value={current.hpMax}
            onChange={(e) => updateFilter({ hpMax: e.target.value })}
            inputMode="numeric"
            placeholder="330"
          />
        </label>
      </div>
      <label>
        排序字段
        <select
          value={current.sortBy}
          onChange={(e) => updateFilter({ sortBy: e.target.value as FilterState["sortBy"] })}
        >
          <option value="name">名称</option>
          <option value="hp">HP</option>
          <option value="updatedAt">更新时间</option>
        </select>
      </label>
      <label>
        排序方向
        <select
          value={current.sortOrder}
          onChange={(e) => updateFilter({ sortOrder: e.target.value as "asc" | "desc" })}
        >
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
      </label>
      <button className="secondary" onClick={resetFilters} type="button">
        重置筛选
      </button>
    </div>
  );

  return (
    <main className="page-shell">
      <header className="topbar glass-panel">
        <div>
          <p className="kicker">Cloudflare Edition</p>
          <h1>TCGdex Atlas</h1>
        </div>
        <div className="lang-switch" role="tablist" aria-label="切换语言">
          {LANGS.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={lang === item}
              className={lang === item ? "active" : ""}
              onClick={() => setLang(item)}
            >
              {LANG_LABELS[item]}
            </button>
          ))}
        </div>
      </header>

      <section className="hero glass-panel">
        <div>
          <p className="kicker">
            <Sparkles size={16} />
            英文 / 日文 / 繁中 独立图鉴
          </p>
          <h2>快速检索卡牌，移动端与桌面端一致体验</h2>
        </div>
        <div className="searchbox" role="search">
          <Search size={18} />
          <input
            value={current.name}
            onChange={(e) => updateFilter({ name: e.target.value })}
            placeholder="输入卡牌名称，如 Pikachu / キャタピー"
            aria-label="搜索卡牌名称"
          />
        </div>
      </section>

      <section className="content-area">
        <aside className="desktop-filters">{filterPanel}</aside>

        <div className="results-panel glass-panel">
          <div className="result-header">
            <p>
              语言 <strong>{LANG_LABELS[lang]}</strong> · 共 <strong>{total}</strong> 张
            </p>
            <a className="docs-link" href="/docs" target="_blank" rel="noreferrer">
              API 文档
            </a>
          </div>

          {loading ? <p className="status">正在查询...</p> : null}
          {error ? <p className="status error">{error}</p> : null}

          {!loading && !error && cards.length === 0 ? (
            <div className="empty-state">
              <h3>没有找到匹配卡牌</h3>
              <p>请尝试缩短关键词或清空筛选条件。</p>
            </div>
          ) : null}

          <div className="card-grid">
            {cards.map((card) => (
              <article key={`${card.lang}-${card.id}`} className="card-item" tabIndex={0}>
                <div className="card-art">
                  {card.imageVariants?.lowWebp ? (
                    <Image
                      src={card.imageVariants.lowWebp}
                      alt={card.name}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
                    />
                  ) : (
                    <div className="card-fallback">No Image</div>
                  )}
                </div>
                <div className="card-body">
                  <h3>{card.name}</h3>
                  <p>{card.setName ?? "Unknown Set"}</p>
                  <div className="chips">
                    {card.types.slice(0, 2).map((type) => (
                      <span key={type}>{type}</span>
                    ))}
                    {card.hp ? <span>HP {card.hp}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="pager" role="navigation" aria-label="分页">
            <button
              onClick={() => updateFilter({ page: Math.max(1, current.page - 1) })}
              disabled={current.page <= 1}
            >
              上一页
            </button>
            <span>
              第 {current.page} / {pageCount} 页
            </span>
            <button
              onClick={() => updateFilter({ page: Math.min(pageCount, current.page + 1) })}
              disabled={current.page >= pageCount}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <button
        className="mobile-filter-trigger"
        onClick={() => setDrawerOpen(true)}
        aria-label="打开筛选器"
      >
        <Filter size={18} />
        筛选
      </button>

      {drawerOpen ? (
        <div className="mobile-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div
            className="mobile-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="移动端筛选器"
          >
            <div className="drawer-header">
              <h2>筛选条件</h2>
              <button onClick={() => setDrawerOpen(false)}>关闭</button>
            </div>
            {filterPanel}
          </div>
        </div>
      ) : null}
    </main>
  );
}
