import { createSignal } from "solid-js";
import type { Frame } from "./ipc/codec";
import { api, daySpot, info, latestWins, type DayInfo } from "./ipc/client";

export const T_MAX = 375;

export const [frame, setFrame] = createSignal<Frame | null>(null);
export const [days, setDays] = createSignal<DayInfo[]>([]);
export const [spotSeries, setSpotSeries] = createSignal<Int32Array>(new Int32Array(0));
export const [stepMin, setStepMin] = createSignal(5);
export const [playing, setPlaying] = createSignal(false);
export const [error, setError] = createSignal("");
export const [loadMs, setLoadMs] = createSignal(0);
export const [storeRoot, setStoreRoot] = createSignal("");
export const [theme, setThemeSig] = createSignal<"dark" | "light">("dark");

const msg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

function accept(f: Frame) {
  setFrame(f);
  setError("");
}

async function run(p: Promise<Frame>) {
  try {
    accept(await p);
  } catch (e) {
    setError(msg(e));
  }
}

// ---- time: absolute targets, latest wins ----
let targetT = 0;
const sendClock = latestWins((t: number) => api.setClock(t), accept);
export function seek(t: number) {
  targetT = Math.max(0, Math.min(T_MAX, Math.round(t)));
  sendClock(targetT);
}
export function stepBy(dir: 1 | -1, minutes = stepMin()) {
  const f = frame();
  const base = f ? Math.max(targetT, 0) : 0;
  seek(base + dir * minutes);
}

// ---- play: JS timeout chain, no timer exists while paused ----
let playTimer: number | undefined;
export function togglePlay() {
  if (playing()) {
    setPlaying(false);
    window.clearTimeout(playTimer);
    return;
  }
  if (targetT >= T_MAX) seek(0);
  setPlaying(true);
  const tick = () => {
    if (!playing()) return;
    if (targetT >= T_MAX) {
      setPlaying(false);
      return;
    }
    stepBy(1);
    playTimer = window.setTimeout(tick, 500);
  };
  playTimer = window.setTimeout(tick, 500);
}

// ---- day ----
export async function loadDay(date: number, keepT = false) {
  const t0 = performance.now();
  try {
    if (playing()) togglePlay();
    const f = await api.openDay(date, keepT);
    targetT = f.t;
    accept(f);
    setSpotSeries(await daySpot());
    setLoadMs(Math.round(performance.now() - t0));
  } catch (e) {
    setError(msg(e));
  }
}
export function gotoDay(delta: 1 | -1) {
  const f = frame();
  const ds = days();
  if (!f || !ds.length) return;
  const i = ds.findIndex((d) => d.d === f.date);
  const j = Math.max(0, Math.min(ds.length - 1, i + delta));
  if (j !== i) void loadDay(ds[j].d);
}
/** Jump to the trading day on or after `date` (falls back to the last day). */
export function jumpToDate(date: number) {
  const ds = days();
  if (!ds.length) return;
  const d = ds.find((x) => x.d >= date) ?? ds[ds.length - 1];
  void loadDay(d.d);
}

// ---- view + legs ----
export const setRank = (rank: number) => run(api.setView({ rank }));
export const setWidth = (widthPx: number) => run(api.setView({ widthPx }));
export const [screen, setScreen] = createSignal<"simulator" | "backtest" | "results">("simulator");
export const [tplus, setTp] = createSignal(0);
export const setTPlus = (tPlus: number) => run(api.setView({ tPlus }));
export function shiftTime(v: number) {
  setTp(v);
  void setTPlus(v);
}
export const addLeg = (side: number, opt: number, strike: number, lots = 1) => {
  const f = frame();
  return run(api.legAdd(side, opt, f ? f.rank : 0, strike, lots));
};
export const updateLeg = (id: number, p: { lots?: number; side?: number; exitT?: number; entryT?: number }) => run(api.legUpdate(id, p));
export const removeLeg = (id: number) => run(api.legRemove(id));
export const clearLegs = () => run(api.legsClear());

// ---- theme ----
export function setTheme(t: "dark" | "light") {
  setThemeSig(t);
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("optlab.theme", t);
  } catch {
    /* storage may be unavailable */
  }
  window.dispatchEvent(new Event("optlab-theme"));
}

export async function boot() {
  try {
    const saved = localStorage.getItem("optlab.theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  } catch {
    /* ignore */
  }
  try {
    const i = await info();
    setDays(i.days);
    setStoreRoot(i.root);
    const dense = [...i.days].reverse().find((d) => d.n >= 900) ?? i.days[i.days.length - 1];
    if (dense) await loadDay(dense.d);
  } catch (e) {
    setError(msg(e));
  }
}
