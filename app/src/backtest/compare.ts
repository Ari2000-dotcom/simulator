// Compare: keep several backtests side by side so the user can see which variation is best.
import { createSignal } from "solid-js";
import { effective, runBacktest, toIdx, type Form, type Stats } from "./model";
import { type Cell, type Grid, type Param, PARAMS } from "./varstate";
import type { DayPnl } from "./tearsheet";

export interface Entry {
  id: number;
  name: string;
  form: Form;
  stats: Stats;
  daily: DayPnl[];
}
export const MAX_ENTRIES = 6;
export const COLORS = ["--qd-text-strong", "#7b96ff", "#34c48b", "#f6b100", "#ff7a90", "#b58cff"];

export const [entries, setEntries] = createSignal<Entry[]>([]);
export const [compareBusy, setCompareBusy] = createSignal(false);
export const [compareError, setCompareError] = createSignal("");
let nextId = 1;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A short, readable name for a strategy: when it enters and what its legs are. */
export function shortName(form: Form): string {
  const f = effective(form);
  const legs = f.legs
    .map((l) => `${l.side > 0 ? "B" : "S"} ${l.opt === 0 ? "CE" : "PE"} ${l.by === "premium" ? "₹" + l.value : l.value === 0 ? "ATM" : "ATM" + (l.value > 0 ? "+" : "") + l.value}`)
    .join(", ");
  const when = f.every > 0 ? `${f.from} every ${f.every >= 60 && f.every % 60 === 0 ? f.every / 60 + "h" : f.every + "m"}` : f.from;
  return `${when} · ${legs}${f.slOn ? ` · SL ${f.slPct}%` : ""}`;
}

export async function addForm(f: Form, name?: string): Promise<boolean> {
  if (entries().length >= MAX_ENTRIES) {
    setCompareError(`Compare holds ${MAX_ENTRIES} strategies. Remove one first.`);
    return false;
  }
  setCompareError("");
  setCompareBusy(true);
  try {
    const form = clone(f);
    const r = await runBacktest(form);
    if (r.stats.trades === 0) {
      setCompareError("That strategy made no trades, so it was not added.");
      return false;
    }
    setEntries([...entries(), { id: nextId++, name: name ?? shortName(form), form, stats: r.stats, daily: r.daily }]);
    return true;
  } catch (e) {
    setCompareError(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
    return false;
  } finally {
    setCompareBusy(false);
  }
}
export const removeEntry = (id: number) => setEntries(entries().filter((e) => e.id !== id));
export const clearEntries = () => setEntries([]);
export const renameEntry = (id: number, name: string) => setEntries(entries().map((e) => (e.id === id ? { ...e, name } : e)));

const t = (idx: number) => {
  const m = idx + 555;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** A copy of the form with one varied setting applied (the pure version of loadVariation). */
export function applyVariation(f: Form, p: Param, value: number): Form {
  const o = clone(f);
  if (!o.use) o.use = { enter: true, conds: true, exit: true, days: true };
  if (p === "first" || p === "every") o.use.enter = true;
  if (p === "exit" || p === "sl" || p === "target") o.use.exit = true;
  switch (p) {
    case "first":
      o.from = t(value);
      if (o.every === 0 || toIdx(o.until) < value) o.until = t(value);
      break;
    case "every":
      o.every = value;
      break;
    case "exit":
      o.exitTime = t(value);
      break;
    case "sl":
      o.slOn = value > 0;
      if (value > 0) o.slPct = value;
      break;
    case "target":
      o.tgtOn = value > 0;
      if (value > 0) o.tgtPct = value;
      break;
    case "premium":
      o.legs.forEach((l) => l.by === "premium" && (l.value = value));
      break;
    case "offset":
      o.legs.forEach((l) => l.by === "atm" && (l.value = value));
      break;
  }
  return o;
}

const short = (p: Param) => ({ first: "entry", every: "every", premium: "premium", offset: "offset", exit: "exit", sl: "SL", target: "target" })[p];
void PARAMS;

/** Add the best `n` cells of a heatmap (by the chosen score) as strategies to compare. */
export async function addTopCells(base: Form, g: Grid, score: (c: Cell) => number, n: number): Promise<number> {
  const top = g.cells
    .filter((c) => c.trades > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.min(n, MAX_ENTRIES - entries().length));
  let added = 0;
  for (const c of top) {
    let f = applyVariation(base, g.xParam, g.xs[c.x].value);
    f = applyVariation(f, g.yParam, g.ys[c.y].value);
    const name = `${short(g.xParam)} ${g.xs[c.x].label} · ${short(g.yParam)} ${g.ys[c.y].label}`;
    if (await addForm(f, name)) added++;
  }
  return added;
}
