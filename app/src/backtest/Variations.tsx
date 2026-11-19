import { For, Show, createMemo } from "solid-js";
import { Grid2x2, Play, Scale } from "lucide-solid";
import { addTopCells, compareBusy } from "./compare";
import { form } from "./state";
import { DASH, num, rupees } from "../lib/format";
import { setScreen } from "../state";
import { setResultsView } from "./state";
import {
  METRICS,
  PARAMS,
  changeParam,
  grid,
  gridError,
  gridRunning,
  metric,
  openCell,
  runGrid,
  setMetric,
  setVx,
  setVy,
  vx,
  vy,
  type Cell,
  type Metric,
} from "./varstate";

function fmt(m: Metric, c: Cell): string {
  switch (m) {
    case "total":
      return rupees(c.total);
    case "avg":
      return rupees(c.avg);
    case "win_rate":
      return c.trades ? `${c.win_rate.toFixed(1)}%` : DASH;
    case "max_dd":
      return c.trades ? rupees(-c.max_dd) : DASH;
    case "profit_factor":
      return c.profit_factor == null ? (c.trades ? "∞" : DASH) : num(c.profit_factor, 2);
  }
}
const raw = (m: Metric, c: Cell): number => (m === "profit_factor" ? c.profit_factor ?? 9 : (c[m] as number));

function AxisPicker(props: { label: string; which: "x" | "y" }) {
  const a = () => (props.which === "x" ? vx : vy);
  const set = props.which === "x" ? setVx : setVy;
  return (
    <div class="axis">
      <span class="cap">{props.label}</span>
      <select class="field" aria-label={props.label} value={a().param} onChange={(e) => changeParam(props.which, e.currentTarget.value as never)}>
        <For each={PARAMS}>{(p) => <option value={p.id}>{p.label}</option>}</For>
      </select>
      <input class="field vals" aria-label={`${props.label} values`} value={a().text} spellcheck={false} onInput={(e) => set("text", e.currentTarget.value)} title="Values separated by commas" />
    </div>
  );
}

export default function Variations() {
  const g = grid;
  // colour scale: sign and size of the metric around its neutral point
  const scale = createMemo(() => {
    const gr = g();
    if (!gr) return () => 0;
    const m = metric();
    const cells = gr.cells.filter((c) => c.trades > 0);
    const vals = cells.map((c) => raw(m, c));
    if (vals.length === 0) return () => 0;
    const neutral = m === "win_rate" ? 50 : m === "profit_factor" ? 1 : 0;
    const maxDev = Math.max(...vals.map((v) => Math.abs(v - neutral)), 1e-9);
    return (c: Cell) => {
      if (c.trades === 0) return 0;
      const v = raw(m, c);
      return m === "max_dd" ? -Math.min(1, v / maxDev) : (v - neutral) / maxDev;
    };
  });
  const best = createMemo(() => {
    const gr = g();
    if (!gr) return -1;
    const m = metric();
    let bi = -1;
    let bv = -Infinity;
    gr.cells.forEach((c, i) => {
      if (c.trades === 0) return;
      const v = m === "max_dd" ? -c.max_dd : raw(m, c);
      if (v > bv) {
        bv = v;
        bi = i;
      }
    });
    return bi;
  });
  const bg = (c: Cell) => {
    const t = scale()(c);
    if (t === 0) return "transparent";
    return `rgb(var(${t > 0 ? "--qd-positive-rgb" : "--qd-negative-rgb"}) / ${Math.round(10 + 55 * Math.min(1, Math.abs(t)))}%)`;
  };
  const noPremium = () => (vx.param === "premium" || vy.param === "premium") && !form.legs.some((l) => l.by === "premium");
  const noOffset = () => (vx.param === "offset" || vy.param === "offset") && !form.legs.some((l) => l.by === "atm");

  return (
    <div class="panel">
      <div class="strip">
        <span class="cap">Show</span>
        <span class="seg">
          <For each={METRICS}>{(m) => <button classList={{ on: metric() === m.id }} onClick={() => setMetric(m.id)}>{m.label}</button>}</For>
        </span>
        <span class="grow" />
        <Show when={g()}>
          <span class="cap">{g()!.cells.length} variations in {g()!.ms} ms</span>
        </Show>
        <Show when={g()}>
          <button
            class="tbtn"
            disabled={compareBusy()}
            title="Run the four best cells in full and compare them"
            onClick={async () => {
              const gr = g()!;
              const m = metric();
              const sc = (c: Cell) => (m === "max_dd" ? -c.max_dd : raw(m, c));
              const n = await addTopCells(JSON.parse(JSON.stringify(form)), gr, sc, 4);
              if (n > 0) setResultsView("compare");
            }}
          >
            <Scale />
            {compareBusy() ? "Running" : "Compare best 4"}
          </button>
        </Show>
        <button class="tbtn key" disabled={gridRunning()} onClick={() => void runGrid()}>
          <Play />
          {gridRunning() ? "Running" : "Run variations"}
        </button>
      </div>
      <div class="vconf">
        <AxisPicker label="Across (columns)" which="x" />
        <AxisPicker label="Down (rows)" which="y" />
      </div>
      <Show when={gridError() || noPremium() || noOffset()}>
        <div class="notice vnote">
          <span>
            {noPremium()
              ? "This strategy has no leg that picks by premium, so a premium axis would change nothing."
              : noOffset()
                ? "This strategy has no leg that picks by ATM offset, so an offset axis would change nothing."
                : gridError()}
          </span>
          <Show when={noPremium() || noOffset()}>
            <button
              class="tbtn"
              onClick={() => {
                const bad = noPremium() ? "premium" : "offset";
                const to = noPremium() ? "offset" : "premium";
                if (vx.param === bad) changeParam("x", to);
                if (vy.param === bad) changeParam("y", to);
              }}
            >
              Use {noPremium() ? "ATM offset" : "premium"} instead
            </button>
          </Show>
        </div>
      </Show>
      <Show
        when={g()}
        fallback={
          <div class="empty">
            <span class="h">No variations yet</span>
            <span class="d">Choose two settings to vary and press Run variations. The strategy comes from the Strategy Builder.</span>
          </div>
        }
      >
        <div class="heat-wrap">
          <div class="heat" style={{ "grid-template-columns": `auto repeat(${g()!.xs.length}, minmax(76px, 1fr))` }}>
            <span class="corner cap">{PARAMS.find((p) => p.id === g()!.yParam)?.label} / {PARAMS.find((p) => p.id === g()!.xParam)?.label}</span>
            <For each={g()!.xs}>{(x) => <span class="hx th">{x.label}</span>}</For>
            <For each={g()!.ys}>
              {(y, yi) => (
                <>
                  <span class="hy th">{y.label}</span>
                  <For each={g()!.xs}>
                    {(_, xi) => {
                      const idx = () => yi() * g()!.xs.length + xi();
                      const c = () => g()!.cells[idx()];
                      return (
                        <button
                          class="hcell"
                          classList={{ best: best() === idx() }}
                          style={{ background: bg(c()) }}
                          title={`${c().trades} trades, win ${c().win_rate.toFixed(1)}%, max drawdown ${rupees(-c().max_dd)}. Click to open in the builder.`}
                          onClick={() => {
                            setResultsView("overview");
                            void openCell(c());
                          }}
                        >
                          <span class="hv">{fmt(metric(), c())}</span>
                          <span class="hn cap">{c().trades} trades</span>
                        </button>
                      );
                    }}
                  </For>
                </>
              )}
            </For>
          </div>
          <div class="hint-line">Green is better, red is worse. The outlined cell is the best. Click a cell to load that variation into the builder and see its full results.</div>
          <Show when={form.every > 0 && (g()!.xParam === "first" || g()!.yParam === "first")}>
            <div class="hint-line">This strategy repeats, so a later first entry also means fewer entries per day. Switch to Avg per trade to compare rows fairly.</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
