import { For, Show, createMemo, createSignal } from "solid-js";
import { Play, Plus } from "lucide-solid";
import { EXAMPLES, formToScript, parseScript } from "./script";
import { describe } from "./model";
import { btError, form, replaceForm, run, running, setBuilderMode, setCapital, setResultsView } from "./state";
import { setScreen } from "../state";
import { addForm, compareBusy } from "./compare";

const KEY = "optlab.bt.script.v1";
const load = () => {
  try {
    return localStorage.getItem(KEY) ?? EXAMPLES[0].code;
  } catch {
    return EXAMPLES[0].code;
  }
};

/** Paste a Python-style strategy script. It is read into settings, never executed. */
export default function ScriptPanel() {
  const [src, setSrc] = createSignal(load());
  const res = createMemo(() => parseScript(src()));
  const edit = (v: string) => {
    setSrc(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  const ok = () => !!res().form && res().errors.length === 0;
  const apply = () => {
    const r = res();
    if (!r.form) return false;
    replaceForm(JSON.parse(JSON.stringify(r.form)));
    if (r.capital) setCapital(r.capital);
    return true;
  };
  const runIt = async () => {
    if (!apply()) return;
    await run();
    if (!btError()) {
      setResultsView("overview");
      setScreen("results");
    }
  };
  const compareIt = async () => {
    const r = res();
    if (!r.form) return;
    if (r.capital) setCapital(r.capital);
    if (await addForm(r.form)) {
      setResultsView("compare");
      setScreen("results");
    }
  };
  const lines = () => src().split("\n").length;
  return (
    <div class="script">
      <div class="tpl">
        <span class="cap">Examples</span>
        <For each={EXAMPLES}>{(e) => <button class="tbtn chip" onClick={() => edit(e.code)}>{e.name}</button>}</For>
        <span class="grow" />
        <button class="tbtn chip" title="Write the current builder settings as a script" onClick={() => edit(formToScript(form))}>
          From builder
        </button>
      </div>
      <div class="script-cols">
        <div class="script-ed">
          <div class="script-bar">
            <span class="cap">Python script</span>
            <span class="grow" />
            <span class="cap">{lines()} lines</span>
          </div>
          <textarea
            class="script-ta"
            spellcheck={false}
            autocapitalize="off"
            aria-label="Strategy script"
            value={src()}
            onInput={(e) => edit(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.currentTarget;
                const s = ta.selectionStart;
                edit(ta.value.slice(0, s) + "    " + ta.value.slice(ta.selectionEnd));
                queueMicrotask(() => ta.setSelectionRange(s + 4, s + 4));
              }
            }}
          />
        </div>
        <div class="script-out">
          <div class="script-bar">
            <span class="cap">Decoded</span>
            <span class="grow" />
            <Show when={ok()}>
              <span class="cap ok">Ready</span>
            </Show>
          </div>
          <Show when={res().errors.length > 0}>
            <div class="script-list err">
              <For each={res().errors}>
                {(e) => (
                  <div>
                    <span class="ln">Line {e.line}</span>
                    {e.msg}
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={res().form && res().errors.length === 0}>
            <div class="readback">{describe(res().form!)}</div>
            <div class="dec-legs">
              <For each={res().form!.legs}>
                {(l) => (
                  <div class="dec-leg" data-side={l.side > 0 ? "buy" : "sell"}>
                    <span>{l.side > 0 ? "Buy" : "Sell"} {l.lots > 1 ? `${l.lots} lots ` : ""}{l.opt === 0 ? "CE" : "PE"}</span>
                    <span class="quiet">{l.by === "premium" ? `≈ ₹${l.value}` : l.value === 0 ? "ATM" : `ATM ${l.value > 0 ? "+" : ""}${l.value}`}{l.rank ? " · next expiry" : ""}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={res().warnings.length > 0 && res().errors.length === 0}>
            <div class="script-list warn">
              <For each={res().warnings}>{(w) => <div>{w.msg}</div>}</For>
            </div>
          </Show>
          <Show when={btError()}>
            <div class="notice">{btError()}</div>
          </Show>
          <div class="script-actions">
            <button class="tbtn key" disabled={!ok() || running()} onClick={() => void runIt()}>
              <Play />
              {running() ? "Running" : "Run script"}
            </button>
            <button class="tbtn" disabled={!ok() || compareBusy()} onClick={() => void compareIt()}>
              <Plus />
              Run and add to compare
            </button>
            <button class="tbtn" disabled={!ok()} onClick={() => apply() && setBuilderMode("build")}>
              Edit in builder
            </button>
          </div>
          <details class="script-help">
            <summary>What the script can say</summary>
            <pre>{`entry = "09:20"          first entry
repeat = 60              minutes, 0 = once  ("1h" works)
last_entry = "14:20"     last entry when repeating
exit = "15:15"
stop_loss = 100          % of premium per leg, None = off
target = None
weekdays = "MTWTF"       "-" skips a day
start = "2024-10-01"     end = None
legs = [
    sell("CE", premium=20),
    buy("PE", atm=300, lots=2, expiry="next"),
]
only_if = [move_from_open(max=0), move_last(30, min=-0.3), day_range(max=1.2)]
capital = 500000`}</pre>
            <p>Plain assignments and arithmetic work (wing = 150 + 150). Imports are ignored. Loops, functions and anything else are refused: the script is read, never run.</p>
          </details>
        </div>
      </div>
    </div>
  );
}
