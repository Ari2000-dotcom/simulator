import { For, Show, createMemo } from "solid-js";
import { capital, result, running } from "./state";
import { dateLabel, num, rupees } from "../lib/format";
import TradeLog from "./TradeLog";
import { tearsheet, type Tearsheet } from "./tearsheet";
import { Chart, Distribution, MonthlyHeatmap, pct1 } from "./charts";


function Stat(props: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div class="kpi">
      <span class="kpi-l">{props.label}</span>
      <span class={`kpi-v ${props.tone ?? ""}`}>{props.value}</span>
      <span class="kpi-s">{props.sub ?? " "}</span>
    </div>
  );
}
const tone = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : undefined);
const sgn = (v: number) => (v > 0 ? "+" : "");
const ratio = (v: number | null) => (v == null ? "∞" : num(v, 2));

function Head(props: { id: string; n: string; title: string; aside?: string }) {
  return (
    <div class="sh" id={props.id}>
      <span class="sh-n">{props.n}</span>
      <h2 class="sh-t">{props.title}</h2>
      <span class="grow" />
      <Show when={props.aside}>
        <span class="cap">{props.aside}</span>
      </Show>
    </div>
  );
}

function Sheet(props: { t: Tearsheet }) {
  const t = () => props.t;
  const wins = () => Math.round(t().winRate * t().r.length);
  return (
    <>
      <Head id="ts-overview" n="01" title="Overview" aside={`${t().r.length} days · ${t().years_span.toFixed(1)} years`} />
      <div class="kgrid">
        <Stat label="Total return" value={`${sgn(t().cumReturn)}${pct1(t().cumReturn)}`} tone={tone(t().cumReturn)} sub={rupees(t().total)} />
        <Stat label="CAGR" value={`${sgn(t().cagr)}${pct1(t().cagr)}`} tone={tone(t().cagr)} />
        <Stat label="Sharpe" value={num(t().sharpe, 2)} />
        <Stat label="Sortino" value={num(t().sortino, 2)} />
        <Stat label="Max drawdown" value={pct1(t().maxDd)} tone="neg" />
        <Stat label="Volatility" value={pct1(t().vol)} />
        <Stat label="Calmar" value={num(t().calmar, 2)} />
        <Stat label="Win rate" value={pct1(t().winRate)} sub={`${wins()} of ${t().r.length} days`} />
        <Stat label="Profit factor" value={ratio(t().profitFactor)} />
        <Stat label="Recovery factor" value={num(t().recovery, 2)} />
        <Stat label="Best day" value={`+${pct1(t().best)}`} tone="pos" />
        <Stat label="Worst day" value={pct1(t().worst)} tone="neg" />
      </div>

      <Head id="ts-performance" n="02" title="Performance" aside="Cumulative return" />
      <div class="chart-wrap">
        <Chart dates={t().dates} ys={t().cum} color="--qd-text-strong" fmt={(v) => `${(v * 100).toFixed(0)}%`} height={300} />
      </div>

      <Head id="ts-risk" n="03" title="Risk" aside="Drawdown from peak" />
      <div class="chart-wrap">
        <Chart dates={t().dates} ys={t().dd} color="--qd-negative" fmt={(v) => `${(v * 100).toFixed(0)}%`} height={200} />
      </div>
      <div class="kgrid">
        <Stat label="Value at risk 95%" value={pct1(t().var95)} tone="neg" />
        <Stat label="Expected shortfall" value={pct1(t().cvar95)} tone="neg" />
        <Stat label="Ulcer index" value={num(t().ulcer * 100, 2)} />
        <Stat label="Loss streak" value={`${t().maxLossStreak}`} sub="days in a row" />
        <Stat label="Win streak" value={`${t().maxWinStreak}`} sub="days in a row" />
        <Stat label="Payoff ratio" value={ratio(t().payoff)} />
      </div>
      <div class="dd-table">
        <div class="trow head th dd-row">
          <span>Worst drawdowns</span>
          <span>Start</span>
          <span>Trough</span>
          <span>Recovered</span>
          <span class="r">Days</span>
          <span class="r">Depth</span>
        </div>
        <For each={t().episodes}>
          {(e, i) => (
            <div class="trow dd-row">
              <span class="quiet">#{i() + 1}</span>
              <span>{dateLabel(e.start)}</span>
              <span>{dateLabel(e.trough)}</span>
              <span class={e.end ? "" : "neg"}>{e.end ? dateLabel(e.end) : "Open"}</span>
              <span class="r">{e.days}</span>
              <span class="r neg">{pct1(e.depth)}</span>
            </div>
          )}
        </For>
      </div>

      <Head id="ts-monthly" n="04" title="Monthly" aside="Return per month, %" />
      <div class="chart-wrap">
        <MonthlyHeatmap t={t()} />
      </div>

      <Head id="ts-distribution" n="05" title="Distribution" aside="Daily returns" />
      <div class="chart-wrap">
        <Distribution r={t().r} />
      </div>
    </>
  );
}

export default function Results() {
  const r = result;
  const ts = createMemo(() => (r() ? tearsheet(r()!.daily, capital()) : null));
  return (
    <div class="panel results">
      <Show
        when={r() && ts()}
        fallback={
          <div class="empty">
            <span class="h">{running() ? "Running" : r() ? "No trades" : "No results yet"}</span>
            <span class="d">{r() ? "No entry could be filled on the tested days." : "Build a strategy in Backtesting and run it."}</span>
          </div>
        }
      >
        <div class="rs-in">
          <Sheet t={ts()!} />
          <Head id="ts-trades" n="06" title="Trades" aside={`${r()!.stats.trades} trades · ${r()!.stats.skipped_entries + (r()!.stats.blocked_entries ?? 0)} not taken`} />
          <TradeLog trades={r()!.trades} />
        </div>
      </Show>
    </div>
  );
}
