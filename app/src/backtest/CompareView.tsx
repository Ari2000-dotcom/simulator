import { For, Show, createMemo } from "solid-js";
import { Plus, Trash2, X } from "lucide-solid";
import { form, capital } from "./state";
import { num } from "../lib/format";
import { tearsheet, type Tearsheet } from "./tearsheet";
import { MultiChart, pct1 } from "./charts";
import {
  COLORS,
  MAX_ENTRIES,
  addForm,
  clearEntries,
  compareBusy,
  compareError,
  entries,
  removeEntry,
  renameEntry,
  type Entry,
} from "./compare";

interface Metric {
  id: string;
  label: string;
  better: "high" | "low";
  get: (t: Tearsheet, e: Entry) => number;
  fmt: (v: number) => string;
}
const sgn = (v: number) => (v > 0 ? "+" : "");
const METRICS: Metric[] = [
  { id: "ret", label: "Total return", better: "high", get: (t) => t.cumReturn, fmt: (v) => `${sgn(v)}${pct1(v)}` },
  { id: "cagr", label: "CAGR", better: "high", get: (t) => t.cagr, fmt: (v) => `${sgn(v)}${pct1(v)}` },
  { id: "sharpe", label: "Sharpe", better: "high", get: (t) => t.sharpe, fmt: (v) => num(v, 2) },
  { id: "sortino", label: "Sortino", better: "high", get: (t) => t.sortino, fmt: (v) => num(v, 2) },
  { id: "dd", label: "Max drawdown", better: "high", get: (t) => t.maxDd, fmt: pct1 },
  { id: "vol", label: "Volatility", better: "low", get: (t) => t.vol, fmt: pct1 },
  { id: "calmar", label: "Calmar", better: "high", get: (t) => t.calmar, fmt: (v) => num(v, 2) },
  { id: "win", label: "Win rate", better: "high", get: (t) => t.winRate, fmt: pct1 },
  { id: "pf", label: "Profit factor", better: "high", get: (t) => t.profitFactor ?? 999, fmt: (v) => (v >= 999 ? "∞" : num(v, 2)) },
  { id: "rec", label: "Recovery factor", better: "high", get: (t) => t.recovery, fmt: (v) => num(v, 2) },
  { id: "worst", label: "Worst day", better: "high", get: (t) => t.worst, fmt: pct1 },
  { id: "avg", label: "Avg per trade", better: "high", get: (_, e) => e.stats.avg, fmt: (v) => `${sgn(v)}${Math.round(v).toLocaleString("en-IN")}` },
];

/** Side-by-side comparison: which variation wins, metric by metric, and overall. */
export default function CompareView() {
  const sheets = createMemo(() => entries().map((e) => tearsheet(e.daily, capital())));
  // for each metric: index of the best and worst entry (null when fewer than two or all equal)
  const marks = createMemo(() =>
    METRICS.map((m) => {
      const vals = entries().map((e, i) => (sheets()[i] ? m.get(sheets()[i]!, e) : NaN));
      if (vals.length < 2) return { best: -1, worst: -1, vals };
      const ok = vals.filter((v) => Number.isFinite(v));
      const hi = Math.max(...ok);
      const lo = Math.min(...ok);
      if (hi === lo) return { best: -1, worst: -1, vals };
      const bestV = m.better === "high" ? hi : lo;
      const worstV = m.better === "high" ? lo : hi;
      return { best: vals.indexOf(bestV), worst: vals.indexOf(worstV), vals };
    }),
  );
  const score = createMemo(() => {
    const wins = entries().map(() => 0);
    marks().forEach((m) => m.best >= 0 && wins[m.best]++);
    return wins;
  });
  const ranking = createMemo(() => {
    const order = entries().map((_, i) => i);
    order.sort((a, b) => score()[b] - score()[a] || (sheets()[b]?.sharpe ?? 0) - (sheets()[a]?.sharpe ?? 0));
    return order;
  });
  const lines = createMemo(() =>
    entries().map((e, i) => ({ name: e.name, color: COLORS[i % COLORS.length], dates: sheets()[i]?.dates ?? [], ys: sheets()[i]?.cum ?? [] })),
  );
  const best = () => ranking()[0];
  const cols = () => `220px repeat(${entries().length}, minmax(140px, 1fr))`;

  return (
    <div class="panel results">
      <div class="rs-in">
        <div class="sh" id="cmp-top">
          <span class="sh-n">{entries().length}/{MAX_ENTRIES}</span>
          <h2 class="sh-t">Compare strategies</h2>
          <span class="grow" />
          <button class="tbtn" disabled={compareBusy() || entries().length >= MAX_ENTRIES} onClick={() => void addForm(form)}>
            <Plus />
            {compareBusy() ? "Running" : "Add current strategy"}
          </button>
          <Show when={entries().length > 0}>
            <button class="tbtn icon" aria-label="Clear all" title="Clear all" onClick={clearEntries}>
              <Trash2 />
            </button>
          </Show>
        </div>
        <Show when={compareError()}>
          <div class="notice cmp-note">{compareError()}</div>
        </Show>
        <Show
          when={entries().length > 0}
          fallback={
            <div class="empty cmp-empty">
              <span class="h">Nothing to compare yet</span>
              <span class="d">Add the current strategy, change a setting, add it again. Or open Variations and press Compare best 4.</span>
            </div>
          }
        >
          <Show when={entries().length >= 2}>
            <div class="sh sh-sub">
              <h3 class="sh-t sm">Best overall</h3>
              <span class="grow" />
              <span class="cap">Wins counted over {METRICS.length} metrics</span>
            </div>
            <div class="rank">
              <For each={ranking()}>
                {(i, pos) => (
                  <div class="rank-row" classList={{ lead: pos() === 0 }}>
                    <span class="rank-n">{pos() + 1}</span>
                    <i class="dot" style={{ background: COLORS[i % COLORS.length].startsWith("--") ? `var(${COLORS[i % COLORS.length]})` : COLORS[i % COLORS.length] }} />
                    <span class="rank-name">{entries()[i].name}</span>
                    <span class="rank-bar">
                      <span style={{ width: `${(score()[i] / METRICS.length) * 100}%` }} />
                    </span>
                    <span class="rank-score">{score()[i]} of {METRICS.length}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="sh sh-sub">
            <h3 class="sh-t sm">Cumulative return</h3>
            <span class="grow" />
            <span class="cap">Hover for the day</span>
          </div>
          <div class="chart-wrap">
            <MultiChart lines={lines()} fmt={(v) => `${(v * 100).toFixed(0)}%`} height={280} />
          </div>

          <div class="sh sh-sub">
            <h3 class="sh-t sm">Side by side</h3>
            <span class="grow" />
            <span class="cap">Green is best, red is worst</span>
          </div>
          <div class="cmp" style={{ "--cols": cols() } as never}>
            <div class="cmp-row cmp-head">
              <span />
              <For each={entries()}>
                {(e, i) => (
                  <span class="cmp-h">
                    <span class="cmp-h-top">
                      <i class="dot" style={{ background: COLORS[i() % COLORS.length].startsWith("--") ? `var(${COLORS[i() % COLORS.length]})` : COLORS[i() % COLORS.length] }} />
                      <button class="tbtn icon tiny-x" aria-label={`Remove ${e.name}`} onClick={() => removeEntry(e.id)}>
                        <X />
                      </button>
                    </span>
                    <input class="cmp-name" value={e.name} aria-label="Strategy name" spellcheck={false} onChange={(ev) => renameEntry(e.id, ev.currentTarget.value)} />
                    <Show when={entries().length >= 2 && i() === best()}>
                      <span class="best-chip">Best · {score()[i()]} of {METRICS.length}</span>
                    </Show>
                  </span>
                )}
              </For>
            </div>
            <div class="cmp-row">
              <span class="cmp-l">Trades</span>
              <For each={entries()}>{(e) => <span class="cmp-v">{e.stats.trades}</span>}</For>
            </div>
            <For each={METRICS}>
              {(m, mi) => (
                <div class="cmp-row">
                  <span class="cmp-l">{m.label}</span>
                  <For each={entries()}>
                    {(e, i) => {
                      const v = () => marks()[mi()].vals[i()];
                      return (
                        <span class="cmp-v" classList={{ best: marks()[mi()].best === i(), worst: marks()[mi()].worst === i() }}>
                          {Number.isFinite(v()) ? m.fmt(v()) : "—"}
                        </span>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
