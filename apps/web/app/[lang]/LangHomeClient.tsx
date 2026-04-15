"use client";

import Image from "next/image";
import { Filter, Search, Sparkles } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCardDetail, fetchCards, fetchFilters, type CardQuery } from "../lib/api";
import { type CardDetail, type CardListItem, type FiltersResponse, type Lang } from "../lib/types";

type FilterState = {
  name: string;
  setId: string;
  rarity: string;
  type: string;
  category: string;
  regulationMark: string;
  stage: string;
  trainerType: string;
  energyType: string;
  illustrator: string;
  hpMin: string;
  hpMax: string;
  sortBy: "name" | "hp" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
};

const DEFAULT_PAGE_SIZE = 24;

const defaultFilter: FilterState = {
  name: "",
  setId: "",
  rarity: "",
  type: "",
  category: "",
  regulationMark: "",
  stage: "",
  trainerType: "",
  energyType: "",
  illustrator: "",
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

const parseWeakRes = (
  value: unknown
): Array<{ type?: string; value?: string | number }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" ? (item as { type?: string; value?: string | number }) : {}))
    .filter((item) => item.type || item.value);
};

const detectCategory = (category?: string): "pokemon" | "trainer" | "energy" | "unknown" => {
  const normalized = String(category ?? "").toLowerCase();
  if (normalized.includes("pok")) return "pokemon";
  if (normalized.includes("trainer")) return "trainer";
  if (normalized.includes("energy")) return "energy";
  return "unknown";
};

type TopBarProps = {
  topbarHidden: boolean;
};

const TopBar = memo(function TopBar({ topbarHidden }: TopBarProps) {
  return (
    <header className={`topbar panel ${topbarHidden ? "topbar-hidden" : ""}`}>
      <div>
        <p className="eyebrow">Cloudflare Edition</p>
        <h1>TCGdex Atlas</h1>
      </div>
    </header>
  );
});

type SearchPanelProps = {
  lang: Lang;
  total: number;
  name: string;
  onNameChange: (value: string) => void;
  onOpenRandom: () => void;
  randomLoading: boolean;
};

const SearchPanel = memo(function SearchPanel({
  lang,
  total,
  name,
  onNameChange,
  onOpenRandom,
  randomLoading
}: SearchPanelProps) {
  return (
    <section className="hero panel" aria-label="搜索与概览">
      <div className="hero-head">
        <p className="eyebrow">
          <Sparkles size={14} />
          英文 / 日文 / 繁中 独立图鉴
        </p>
        <h2>逻辑卡检索与原样详情展示</h2>
        <p className="hero-sub">当前语言：{LANG_LABELS[lang]} · 共 {total} 张逻辑卡</p>
      </div>
      <div className="hero-actions">
        <div className="searchbox" role="search">
          <Search size={18} />
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="输入卡牌名称，支持繁简关键词"
            aria-label="搜索卡牌名称"
          />
        </div>
        <div className="hero-action-buttons">
          <button className="ghost-btn" type="button" onClick={onOpenRandom} disabled={randomLoading}>
            {randomLoading ? "随机中..." : "随机一张"}
          </button>
          <a className="docs-link" href="/docs" target="_blank" rel="noreferrer">
            API 文档
          </a>
        </div>
      </div>
    </section>
  );
});

type FilterPanelProps = {
  current: FilterState;
  filters?: FiltersResponse;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
};

const FilterPanel = memo(function FilterPanel({ current, filters, onChange, onReset }: FilterPanelProps) {
  return (
    <div className="panel filter-panel" role="region" aria-label="筛选器">
      <h2>筛选器</h2>

      <section className="filter-group" aria-label="基础筛选">
        <h3>基础筛选</h3>
        <label>
          名称
          <input
            value={current.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="关键词"
          />
        </label>
        <label>
          系列
          <select value={current.setId} onChange={(e) => onChange({ setId: e.target.value })}>
            <option value="">全部</option>
            {filters?.sets?.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          分类
          <select value={current.category} onChange={(e) => onChange({ category: e.target.value })}>
            <option value="">全部</option>
            {filters?.categories?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          稀有度
          <select value={current.rarity} onChange={(e) => onChange({ rarity: e.target.value })}>
            <option value="">全部</option>
            {filters?.rarities?.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </label>
        <label>
          属性
          <select value={current.type} onChange={(e) => onChange({ type: e.target.value })}>
            <option value="">全部</option>
            {filters?.types?.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="filter-group" aria-label="规则筛选">
        <h3>规则筛选</h3>
        <label>
          规则标识
          <select value={current.regulationMark} onChange={(e) => onChange({ regulationMark: e.target.value })}>
            <option value="">全部</option>
            {filters?.regulationMarks?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          进化阶段
          <select value={current.stage} onChange={(e) => onChange({ stage: e.target.value })}>
            <option value="">全部</option>
            {filters?.stages?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          训练家类型
          <select value={current.trainerType} onChange={(e) => onChange({ trainerType: e.target.value })}>
            <option value="">全部</option>
            {filters?.trainerTypes?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          能量类型
          <select value={current.energyType} onChange={(e) => onChange({ energyType: e.target.value })}>
            <option value="">全部</option>
            {filters?.energyTypes?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="filter-group" aria-label="进阶筛选">
        <h3>进阶筛选</h3>
        <label>
          画师
          <select value={current.illustrator} onChange={(e) => onChange({ illustrator: e.target.value })}>
            <option value="">全部</option>
            {filters?.illustrators?.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="hp-range">
          <label>
            HP 最低
            <input
              value={current.hpMin}
              onChange={(e) => onChange({ hpMin: e.target.value })}
              inputMode="numeric"
              placeholder="0"
            />
          </label>
          <label>
            HP 最高
            <input
              value={current.hpMax}
              onChange={(e) => onChange({ hpMax: e.target.value })}
              inputMode="numeric"
              placeholder="330"
            />
          </label>
        </div>
      </section>

      <section className="filter-group" aria-label="排序与分页">
        <h3>排序</h3>
        <label>
          排序字段
          <select value={current.sortBy} onChange={(e) => onChange({ sortBy: e.target.value as FilterState["sortBy"] })}>
            <option value="name">名称</option>
            <option value="hp">HP</option>
            <option value="updatedAt">更新时间</option>
          </select>
        </label>
        <label>
          排序方向
          <select value={current.sortOrder} onChange={(e) => onChange({ sortOrder: e.target.value as FilterState["sortOrder"] })}>
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </label>
      </section>

      <button className="secondary-btn" onClick={onReset} type="button">
        重置筛选
      </button>
    </div>
  );
});

type CardGridProps = {
  cards: CardListItem[];
  loading: boolean;
  error: string | null;
  onOpenCard: (card: CardListItem) => void;
};

const CardGrid = memo(function CardGrid({ cards, loading, error, onOpenCard }: CardGridProps) {
  if (loading) return <p className="status">正在查询...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <h3>没有找到匹配卡牌</h3>
        <p>请尝试缩短关键词或清空筛选条件。</p>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {cards.map((card) => (
        <article
          key={`${card.lang}-${card.id}-${card.defaultPrintingId ?? "default"}`}
          className="card-item"
          tabIndex={0}
          onClick={() => onOpenCard(card)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenCard(card);
            }
          }}
        >
          <div className="card-art">
            {card.imageVariants?.lowWebp ? (
              <Image
                src={card.imageVariants.lowWebp}
                alt={card.name}
                fill
                loading="lazy"
                sizes="(max-width: 768px) 46vw, (max-width: 1200px) 28vw, 20vw"
              />
            ) : (
              <div className="card-fallback">No Image</div>
            )}
          </div>
          <div className="card-body">
            <h3 title={card.name}>{card.name}</h3>
            <p className="set-line" title={card.setName ?? "Unknown Set"}>{card.setName ?? "Unknown Set"}</p>
            {card.printingsCount && card.printingsCount > 1 ? <p className="meta-line">版本数：{card.printingsCount}</p> : null}
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
  );
});

type DetailModalProps = {
  activeCard: CardDetail | null;
  selectedPrintingId: string | null;
  detailLoading: boolean;
  rawCopied: boolean;
  onClose: () => void;
  onSwitchPrinting: (id: string) => void;
  onCopyRawJson: () => void;
};

const DetailModal = memo(function DetailModal({
  activeCard,
  selectedPrintingId,
  detailLoading,
  rawCopied,
  onClose,
  onSwitchPrinting,
  onCopyRawJson
}: DetailModalProps) {
  if (!activeCard) return null;

  const selectedPrinting = activeCard.printings?.find((item) => item.id === selectedPrintingId) ?? activeCard.printings?.[0] ?? null;
  const rawJsonText = JSON.stringify(activeCard, null, 2);
  const categoryKind = detectCategory(activeCard.category);
  const weaknesses = parseWeakRes((activeCard as Record<string, unknown>).weaknesses);
  const resistances = parseWeakRes((activeCard as Record<string, unknown>).resistances);

  return (
    <div className="overlay detail-overlay" onClick={onClose}>
      <div
        className="detail-modal panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="卡牌详情"
      >
        <div className="drawer-header">
          <h2>{activeCard.name ?? "卡牌详情"}</h2>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="detail-grid">
          <div className="detail-image">
            {selectedPrinting?.imageVariants?.highWebp ?? activeCard.imageVariants?.highWebp ? (
              <Image
                src={selectedPrinting?.imageVariants?.highWebp ?? activeCard.imageVariants?.highWebp ?? ""}
                alt={activeCard.name ?? "card"}
                fill
                sizes="(max-width: 768px) 92vw, 360px"
              />
            ) : (
              <div className="card-fallback">No Image</div>
            )}
          </div>

          <div className="detail-body">
            <p className="detail-meta">
              {selectedPrinting?.setName ?? activeCard.set?.name ?? "Unknown Set"} · {activeCard.rarity ?? "Unknown"}
            </p>
            <div className="chips">
              {(activeCard.types ?? []).map((type) => (
                <span key={type}>{type}</span>
              ))}
              {activeCard.hp ? <span>HP {activeCard.hp}</span> : null}
              {activeCard.category ? <span>{activeCard.category}</span> : null}
              {activeCard.stage ? <span>{activeCard.stage}</span> : null}
              {activeCard.regulationMark ? <span>Reg {activeCard.regulationMark}</span> : null}
            </div>

            {activeCard.illustrator ? <p>插画师：{activeCard.illustrator}</p> : null}

            {categoryKind === "pokemon" ? (
              <>
                {activeCard.abilities?.length ? (
                  <section>
                    <h3>特性 / 能力</h3>
                    {activeCard.abilities.map((ability, idx) => (
                      <p key={`${ability.name ?? "ability"}-${idx}`}>
                        <strong>{ability.name ?? "能力"}</strong>
                        {ability.type ? ` (${ability.type})` : ""}：{ability.effect ?? "-"}
                      </p>
                    ))}
                  </section>
                ) : null}

                {activeCard.attacks?.length ? (
                  <section>
                    <h3>招式</h3>
                    {activeCard.attacks.map((attack, idx) => (
                      <p key={`${attack.name ?? "attack"}-${idx}`}>
                        <strong>{attack.name ?? "招式"}</strong>
                        {attack.damage ? ` (${attack.damage})` : ""}
                        {attack.cost?.length ? ` [${attack.cost.join("/")}]` : ""}：{attack.effect ?? "-"}
                      </p>
                    ))}
                  </section>
                ) : null}

                {activeCard.effect ? (
                  <section>
                    <h3>效果</h3>
                    <p>{activeCard.effect}</p>
                  </section>
                ) : null}

                {weaknesses.length ? (
                  <section>
                    <h3>弱点</h3>
                    {weaknesses.map((item, idx) => (
                      <p key={`w-${idx}`}>{`${item.type ?? ""} ${item.value ?? ""}`.trim()}</p>
                    ))}
                  </section>
                ) : null}

                {resistances.length ? (
                  <section>
                    <h3>抗性</h3>
                    {resistances.map((item, idx) => (
                      <p key={`r-${idx}`}>{`${item.type ?? ""} ${item.value ?? ""}`.trim()}</p>
                    ))}
                  </section>
                ) : null}

                {(activeCard as Record<string, unknown>).retreat ? (
                  <section>
                    <h3>撤退</h3>
                    <p>{String((activeCard as Record<string, unknown>).retreat)}</p>
                  </section>
                ) : null}

                {!activeCard.attacks?.length && !activeCard.abilities?.length && !activeCard.effect && !(activeCard.rules?.length) ? (
                  <section>
                    <h3>说明</h3>
                    <p>该语言数据暂缺效果文本。</p>
                  </section>
                ) : null}
              </>
            ) : null}

            {categoryKind === "trainer" ? (
              <>
                {(activeCard as Record<string, unknown>).trainerType ? (
                  <p>训练家类型：{String((activeCard as Record<string, unknown>).trainerType)}</p>
                ) : null}
                {activeCard.effect ? (
                  <section>
                    <h3>效果</h3>
                    <p>{activeCard.effect}</p>
                  </section>
                ) : null}
                {!activeCard.effect && !(activeCard.rules?.length) ? (
                  <section>
                    <h3>说明</h3>
                    <p>该语言数据暂缺效果文本。</p>
                  </section>
                ) : null}
              </>
            ) : null}

            {categoryKind === "energy" ? (
              <>
                {(activeCard as Record<string, unknown>).energyType ? (
                  <p>能量类型：{String((activeCard as Record<string, unknown>).energyType)}</p>
                ) : null}
                {activeCard.effect ? (
                  <section>
                    <h3>效果</h3>
                    <p>{activeCard.effect}</p>
                  </section>
                ) : null}
                {!activeCard.effect && !(activeCard.rules?.length) ? (
                  <section>
                    <h3>说明</h3>
                    <p>该语言数据暂缺效果文本。</p>
                  </section>
                ) : null}
              </>
            ) : null}

            {activeCard.description ? (
              <section>
                <h3>描述</h3>
                <p>{activeCard.description}</p>
              </section>
            ) : null}

            {activeCard.rules?.length ? (
              <section>
                <h3>规则</h3>
                {activeCard.rules.map((rule, idx) => (
                  <p key={`${rule}-${idx}`}>{rule}</p>
                ))}
              </section>
            ) : null}

            {activeCard.printings && activeCard.printings.length > 1 ? (
              <section>
                <h3>同逻辑卡版本</h3>
                <label>
                  <span>选择版本</span>
                  <select
                    value={selectedPrintingId ?? activeCard.defaultPrintingId ?? activeCard.id ?? ""}
                    onChange={(e) => onSwitchPrinting(e.target.value)}
                  >
                    {activeCard.printings.map((printing) => (
                      <option key={printing.id} value={printing.id}>
                        {printing.setName ?? printing.setId ?? "Unknown"} · {printing.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p>共 {activeCard.printings.length} 个版本。</p>
              </section>
            ) : null}

            <details className="raw-json">
              <summary>原始 JSON</summary>
              <div className="raw-json-actions">
                <button type="button" onClick={onCopyRawJson}>
                  {rawCopied ? "已复制" : "复制 JSON"}
                </button>
              </div>
              <pre>{rawJsonText}</pre>
            </details>

            {process.env.NODE_ENV !== "production" ? (
              <p className="dev-hint">字段覆盖：{Object.keys(activeCard).sort().join(", ")}</p>
            ) : null}
          </div>
        </div>

        {detailLoading ? <p className="status">正在加载详情...</p> : null}
      </div>
    </div>
  );
});

export default function LangHomeClient({ lang }: { lang: Lang }) {
  const [current, setCurrent] = useState<FilterState>({ ...defaultFilter });
  const [filterOptions, setFilterOptions] = useState<FiltersResponse | null>(null);
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<CardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [topbarHidden, setTopbarHidden] = useState(false);
  const [langTotal, setLangTotal] = useState(0);
  const [randomLoading, setRandomLoading] = useState(false);
  const [selectedPrintingId, setSelectedPrintingId] = useState<string | null>(null);
  const [rawCopied, setRawCopied] = useState(false);

  const detailAbortRef = useRef<AbortController | null>(null);

  const query = useMemo<CardQuery>(() => {
    return {
      name: current.name || undefined,
      setId: current.setId || undefined,
      rarity: current.rarity || undefined,
      type: current.type || undefined,
      category: current.category || undefined,
      regulationMark: current.regulationMark || undefined,
      stage: current.stage || undefined,
      trainerType: current.trainerType || undefined,
      energyType: current.energyType || undefined,
      illustrator: current.illustrator || undefined,
      hpMin: current.hpMin ? Number(current.hpMin) : undefined,
      hpMax: current.hpMax ? Number(current.hpMax) : undefined,
      sortBy: current.sortBy,
      sortOrder: current.sortOrder,
      page: current.page,
      pageSize: DEFAULT_PAGE_SIZE
    };
  }, [current]);

  const pageCount = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  useEffect(() => {
    const controller = new AbortController();
    fetchFilters(lang, { signal: controller.signal })
      .then((res) => {
        setFilterOptions(res);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      });

    return () => controller.abort();
  }, [lang]);

  useEffect(() => {
    setCurrent({ ...defaultFilter });
    setCards([]);
    setTotal(0);
    setLangTotal(0);
    setError(null);
    setDrawerOpen(false);
    setActiveCard(null);
    setSelectedPrintingId(null);
  }, [lang]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      fetchCards(lang, query, { signal: controller.signal })
        .then((res) => {
          setCards(res.items ?? []);
          setTotal(res.total ?? 0);
        })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          setError((e as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [lang, query]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchCards(lang, { page: 1, pageSize: 1, sortBy: "updatedAt", sortOrder: "desc" }, { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        setLangTotal(res.total ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setLangTotal((prev) => prev || 0);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lang]);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    let rafId = 0;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        setTopbarHidden((prev) => {
          if (y < 108) return false;
          if (delta > 10) return true;
          if (delta < -10) return false;
          return prev;
        });
        lastY = y;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  const updateFilter = useCallback(
    (patch: Partial<FilterState>) => {
      setCurrent((prev) => {
        const next = { ...prev, ...patch };
        if (Object.keys(patch).some((key) => key !== "page")) {
          next.page = 1;
        }
        return next;
      });
    },
    []
  );

  const resetFilters = useCallback(() => {
    setCurrent({ ...defaultFilter });
  }, []);

  const openCardDetail = useCallback(
    async (card: CardListItem) => {
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;

      try {
        setDetailLoading(true);
        const detail = await fetchCardDetail(lang, card.id, { signal: controller.signal });
        setActiveCard(detail);
        setSelectedPrintingId(detail.defaultPrintingId ?? detail.id ?? null);
        setRawCopied(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    },
    [lang]
  );

  const closeDetail = useCallback(() => {
    detailAbortRef.current?.abort();
    setActiveCard(null);
  }, []);

  const openRandomCard = useCallback(async () => {
    const count = langTotal || total;
    if (!count || count <= 0) return;

    const controller = new AbortController();
    try {
      setRandomLoading(true);
      const randomPage = Math.floor(Math.random() * count) + 1;
      const randomResult = await fetchCards(
        lang,
        {
          page: randomPage,
          pageSize: 1,
          sortBy: "updatedAt",
          sortOrder: "desc"
        },
        { signal: controller.signal }
      );
      const randomCard = randomResult.items?.[0];
      if (randomCard) await openCardDetail(randomCard);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setRandomLoading(false);
    }
  }, [lang, langTotal, total, openCardDetail]);

  const switchPrinting = useCallback(
    async (printingId: string) => {
      if (!activeCard || !printingId) return;
      if (printingId === (activeCard.id ?? "")) {
        setSelectedPrintingId(printingId);
        return;
      }

      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;

      try {
        setDetailLoading(true);
        const detail = await fetchCardDetail(lang, printingId, { signal: controller.signal });
        if (activeCard.printings?.length && detail.logicalId === activeCard.logicalId) {
          detail.printings = activeCard.printings;
        }
        setActiveCard(detail);
        setSelectedPrintingId(printingId);
        setRawCopied(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    },
    [activeCard, lang]
  );

  const copyRawJson = useCallback(async () => {
    if (!activeCard) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(activeCard, null, 2));
      setRawCopied(true);
      window.setTimeout(() => setRawCopied(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [activeCard]);

  return (
    <main className="page-shell">
      <TopBar topbarHidden={topbarHidden} />

      <SearchPanel
        lang={lang}
        total={total}
        name={current.name}
        onNameChange={(value) => updateFilter({ name: value })}
        onOpenRandom={() => void openRandomCard()}
        randomLoading={randomLoading}
      />

      <section className="content-area">
        <aside className="desktop-filters">
          <FilterPanel current={current} filters={filterOptions ?? undefined} onChange={updateFilter} onReset={resetFilters} />
        </aside>

        <div className="results-panel panel">
          <CardGrid cards={cards} loading={loading} error={error} onOpenCard={(card) => void openCardDetail(card)} />

          <div className="pager" role="navigation" aria-label="分页">
            <button onClick={() => updateFilter({ page: Math.max(1, current.page - 1) })} disabled={current.page <= 1}>
              上一页
            </button>
            <span>
              第 {current.page} / {pageCount} 页
            </span>
            <button onClick={() => updateFilter({ page: Math.min(pageCount, current.page + 1) })} disabled={current.page >= pageCount}>
              下一页
            </button>
          </div>
        </div>
      </section>

      <button className="mobile-filter-trigger" onClick={() => setDrawerOpen(true)} aria-label="打开筛选器">
        <Filter size={18} />
        筛选
      </button>

      {drawerOpen ? (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="移动端筛选器">
            <div className="drawer-header">
              <h2>筛选条件</h2>
              <button onClick={() => setDrawerOpen(false)}>关闭</button>
            </div>
            <FilterPanel current={current} filters={filterOptions ?? undefined} onChange={updateFilter} onReset={resetFilters} />
          </div>
        </div>
      ) : null}

      <DetailModal
        activeCard={activeCard}
        selectedPrintingId={selectedPrintingId}
        detailLoading={detailLoading}
        rawCopied={rawCopied}
        onClose={closeDetail}
        onSwitchPrinting={(id) => void switchPrinting(id)}
        onCopyRawJson={() => void copyRawJson()}
      />
    </main>
  );
}
