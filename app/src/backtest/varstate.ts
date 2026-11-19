// Variations: run one strategy over a grid of two changing settings and show the outcome as a heatmap.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { toIdx, toSpec, type Form } from "./model";
import { form, persist, replaceForm, run, setForm } from "./state";

export type Param = "first" | "every" | "premium" | "offset" | "exit" | "sl" | "target";
export type Metric = "total" | "win_rate" | "avg" | "max_dd" | "profit_factor";

export const PARAMS: { id: Param; label: string; unit: string; time: boolean; defaults: string }[] = [
  { id: "first", label: "First entry time", unit: "", time: true, defaults: "09:20, 10:20, 11:20, 12:20, 13:20, 14:20" },
  { id: "premium", label: "Premium of each leg", unit: "₹", time: false, defaults: "10, 15, 20, 25, 30" },
  { id: "offset", label: "ATM offset", unit: "pts", time: false, defaults: "0, 50, 100, 150, 200" },
  { id: "every", label: "Repeat every (min)", unit: "min", time: false, defaults: "0, 30, 60, 120" },
  { id: "exit", label: "Exit time", unit: "", time: true, defaults: "13:00, 14:00, 15:00, 15:15, 15:25" },
  { id: "sl", label: "Stop loss % (0 = off)", unit: "%", time: false, defaults: "0, 50, 100, 150" },
  { id: "target", label: "Target % (0 = off)", unit: "%", time: false, defaults: "0, 25, 50, 75" },
];
export const METRICS: { id: Metric; label: string }[] = [
  { id: "total", label: "Net P&L" },
  { id: "win_rate", label: "Win rate" },
  { id: "avg", label: "Avg per trade" },
  { id: "max_dd", label: "Max drawdown" },
  { id: "profit_factor", label: "Profit factor" },
];

export interface AxisForm {
  param: Param;
  text: string;
}
export const [vx, setVx] = createStore<AxisForm>({ param: "premium", text: PARAMS[1].defaults });
export const [vy, setVy] = createStore<AxisForm>({ param: "first", text: PARAMS[0].defaults });
export const [metric, setMetric] = createSignal<Metric>("total");

export interface Cell {
  x: number;
  y: number;
  trades: number;
  total: number;
  win_rate: number;
  avg: number;
  max_dd: number;
  profit_factor: number | null;
}
export interface Grid {
  cells: Cell[];
  xs: { label: string; value: number }[];
  ys: { label: string; value: number }[];
  xParam: Param;
  yParam: Param;
  ms: number;
}
export const [grid, setGrid] = createSignal<Grid | null>(null);
export const [gridRunning, setGridRunning] = createSignal(false);
export const [gridError, setGridError] = createSignal("");

const info = (p: Param) => PARAMS.find((x) => x.id === p)!;

export function parseValues(a: AxisForm): { label: string; value: number }[] {
  const meta = info(a.param);
  return a.text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ label: s, value: meta.time ? toIdx(s) : parseFloat(s) }))
    .filter((v) => Number.isFinite(v.value))
    .slice(0, 20);
}

export function changeParam(which: "x" | "y", p: Param) {
  const set = which === "x" ? setVx : setVy;
  set({ param: p, text: info(p).defaults });
}

export async function runGrid() {
  if (gridRunning()) return;
  const xs = parseValues(vx);
  const ys = parseValues(vy);
  setGridError("");
  if (vx.param === vy.param) {
    setGridError("Pick two different settings for the two axes.");
    return;
  }
  if (xs.length === 0 || ys.length === 0) {
    setGridError("Type at least one value for each axis, separated by commas.");
    return;
  }
  setGridRunning(true);
  try {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const spec = toSpec(JSON.parse(JSON.stringify(form)) as Form);
    const r = await invoke<{ cells: Cell[]; ms: number }>("bt_grid", {
      spec,
      x: { param: vx.param, values: xs.map((v) => v.value) },
      y: { param: vy.param, values: ys.map((v) => v.value) },
    });
    setGrid({ cells: r.cells, xs, ys, xParam: vx.param, yParam: vy.param, ms: r.ms });
  } catch (e) {
    setGridError(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
  } finally {
    setGridRunning(false);
  }
}

/** Put one variation's settings into the form so it can be run and inspected in full. */
export function loadVariation(p: Param, label: string, value: number): void {
  const t = (idx: number) => {
    const m = idx + 555;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  switch (p) {
    case "first":
      setForm("from", t(value));
      if (form.every === 0 || toIdx(form.until) < value) setForm("until", t(value));
      break;
    case "every":
      setForm("every", value);
      break;
    case "exit":
      setForm("exitTime", t(value));
      break;
    case "sl":
      setForm({ slOn: value > 0, slPct: value > 0 ? value : form.slPct });
      break;
    case "target":
      setForm({ tgtOn: value > 0, tgtPct: value > 0 ? value : form.tgtPct });
      break;
    case "premium":
      setForm("legs", (l) => l.by === "premium", "value", value);
      break;
    case "offset":
      setForm("legs", (l) => l.by === "atm", "value", value);
      break;
  }
  void label;
  persist();
}

export async function openCell(c: Cell) {
  const g = grid();
  if (!g) return;
  loadVariation(g.xParam, g.xs[c.x].label, g.xs[c.x].value);
  loadVariation(g.yParam, g.ys[c.y].label, g.ys[c.y].value);
  replaceForm(JSON.parse(JSON.stringify(form)) as Form);
  await run();
}
