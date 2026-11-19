import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { defaultForm, runBacktest, type BtResult, type Form } from "./model";

const KEY = "optlab.bt.form.v1";

function load(): Form {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...defaultForm(), ...JSON.parse(s) };
  } catch {
    /* ignore */
  }
  return defaultForm();
}

export const [form, setForm] = createStore<Form>(load());
export const [result, setResult] = createSignal<BtResult | null>(null);
export const [running, setRunning] = createSignal(false);
export const [btError, setBtError] = createSignal("");
const CAP_KEY = "optlab.bt.capital.v1";
function loadCap(): number {
  try {
    const v = Number(localStorage.getItem(CAP_KEY));
    if (v > 0) return v;
  } catch {
    /* ignore */
  }
  return 500000;
}
export const [capital, setCapitalRaw] = createSignal(loadCap());
export function setCapital(v: number) {
  setCapitalRaw(v);
  try {
    localStorage.setItem(CAP_KEY, String(v));
  } catch {
    /* ignore */
  }
}
export const [builderMode, setBuilderMode] = createSignal<"build" | "script">("build");
export const [resultsView, setResultsView] = createSignal<"overview" | "variations" | "compare">("overview");

export function replaceForm(f: Form) {
  setForm(reconcile(f));
  persist();
}
export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    /* ignore */
  }
}

export async function run() {
  if (running()) return;
  setRunning(true);
  setBtError("");
  try {
    // let the "Running" state paint before the (fast) native call
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    setResult(await runBacktest(JSON.parse(JSON.stringify(form)) as Form));
  } catch (e) {
    setBtError(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
  } finally {
    setRunning(false);
  }
}
