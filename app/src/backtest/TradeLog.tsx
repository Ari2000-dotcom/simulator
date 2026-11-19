import { For, Show, createMemo, createSignal } from "solid-js";
import type { TradeRow } from "./model";
import { clock, dateLabel, rupees } from "../lib/format";

const WHY = ["Time", "Stop loss", "Target"];
const PAGE = 100;
type Filter = "all" | "wins" | "losses";

/** Numbered trade log: each trade is #n, its legs sit underneath as n.1, n.2 ... */
export default function TradeLog(props: { trades: TradeRow[] }) {
  const [filter, setFilter] = createSignal<Filter>("all");
  const [legs, setLegs] = createSignal(true);
  const [shown, setShown] = createSignal(PAGE);
  // keep each trade's own number (its place in the run) even when a filter hides others
  const numbered = createMemo(() => props.trades.map((t, i) => ({ n: i + 1, t })));
  const rows = createMemo(() => {
    const f = filter();
    return numbered().filter((x) => (f === "wins" ? x.t.pnl > 0 : f === "losses" ? x.t.pnl < 0 : true));
  });
  const FILTERS: [string, Filter][] = [["All", "all"], ["Wins", "wins"], ["Losses", "losses"]];
  return (
    <div class="tlog">
      <div class="tlog-bar">
        <span class="seg">
          <For each={FILTERS}>
            {([label, v]) => (
              <button
                classList={{ on: filter() === v }}
                onClick={() => {
                  setFilter(v);
                  setShown(PAGE);
                }}
              >
                {label}
              </button>
            )}
          </For>
        </span>
        <span class="cap">{rows().length} trades</span>
        <span class="grow" />
        <button class="tbtn chip" classList={{ on: legs() }} aria-pressed={legs()} onClick={() => setLegs(!legs())}>
          {legs() ? "Legs shown" : "Legs hidden"}
        </button>
      </div>
      <div class="tl-row tl-head th">
        <span>#</span>
        <span>Date</span>
        <span>Entry</span>
        <span>Exit</span>
        <span>Position</span>
        <span>Closed by</span>
        <span class="r">P&amp;L</span>
      </div>
      <For each={rows().slice(0, shown())}>
        {({ n, t }) => (
          <div class="tl-trade">
            <div class="tl-row tl-main">
              <span class="tl-id">{n}</span>
              <span>{dateLabel(t.d)}</span>
              <span>{clock(t.et)}</span>
              <span>{clock(t.xt)}</span>
              <span class="quiet">{t.legs.length} {t.legs.length === 1 ? "leg" : "legs"}</span>
              <span class={t.r === 1 ? "neg" : t.r === 2 ? "pos" : "quiet"}>{WHY[t.r]}</span>
              <span class="r tl-pnl" classList={{ pos: t.pnl > 0, neg: t.pnl < 0 }}>{rupees(t.pnl)}</span>
            </div>
            <Show when={legs()}>
              <For each={t.legs}>
                {(l, i) => (
                  <div class="tl-row tl-leg">
                    <span class="tl-id quiet">{n}.{i() + 1}</span>
                    <span class="tl-what">
                      <i class="tl-side" classList={{ buy: l.side > 0, sell: l.side < 0 }}>{l.side > 0 ? "Buy" : "Sell"}</i>
                      {l.opt === 0 ? "CE" : "PE"} {l.strike}
                      <span class="quiet"> × {l.lots} {l.lots === 1 ? "lot" : "lots"}</span>
                    </span>
                    <span class="tl-px quiet">{(l.entry / 100).toFixed(1)} → {(l.exit / 100).toFixed(1)}</span>
                    <span />
                    <span class="r tl-pnl" classList={{ pos: l.pnl > 0, neg: l.pnl < 0 }}>{rupees(l.pnl)}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        )}
      </For>
      <Show when={rows().length > shown()}>
        <div class="more">
          <button class="tbtn chip" onClick={() => setShown(shown() + 200)}>Show 200 more · {rows().length - shown()} left</button>
        </div>
      </Show>
      <Show when={rows().length === 0}>
        <div class="empty compact"><span class="h">No trades</span></div>
      </Show>
    </div>
  );
}
