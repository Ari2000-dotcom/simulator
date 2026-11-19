import { For, Show, type JSX } from "solid-js";
import { Play, Plus, RotateCcw, Trash2 } from "lucide-solid";
import { COND_KINDS, TEMPLATES, defaultForm, describe, type CondForm, type LegForm, type StepKey } from "./model";
import { btError, builderMode, form, persist, replaceForm, run, running, setBuilderMode, setForm, setResultsView } from "./state";
import ScriptPanel from "./ScriptPanel";
import { setScreen } from "../state";

function Seg<T extends string | number>(props: { options: [string, T][]; value: T; onChange: (v: T) => void; title?: string }) {
  return (
    <span class="seg" title={props.title}>
      <For each={props.options}>
        {([label, v]) => (
          <button classList={{ on: props.value === v }} onClick={() => props.onChange(v)}>
            {label}
          </button>
        )}
      </For>
    </span>
  );
}

function Field(props: { label: string; children: JSX.Element; grow?: boolean }) {
  return (
    <label class="fld" classList={{ grow: props.grow }}>
      <span class="cap">{props.label}</span>
      {props.children}
    </label>
  );
}

function Section(props: { title: string; children: JSX.Element; aside?: JSX.Element; step?: StepKey; required?: boolean; note?: string }) {
  const on = () => (props.step ? form.use?.[props.step] !== false : true);
  const flip = () => {
    if (!props.step) return;
    setForm("use", props.step, !on());
    persist();
  };
  return (
    <section class="sec" classList={{ off: !on() }}>
      <div class="sec-h">
        <span class="sec-t">{props.title}</span>
        <span class="grow" />
        <Show when={on()}>{props.aside}</Show>
        <Show when={props.step}>
          <button class="sw" role="switch" aria-checked={on()} aria-label={`Use ${props.title}`} title={on() ? "Skip this step" : "Use this step"} onClick={flip}>
            <i />
          </button>
        </Show>
        <Show when={props.required}>
          <span class="cap req">Required</span>
        </Show>
      </div>
      <Show when={on()} fallback={<div class="quiet skip-note">{props.note ?? "Skipped"}</div>}>
        {props.children}
      </Show>
    </section>
  );
}

const optNum = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const numIn = (v: string, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

const REPEAT: [string, number][] = [["Once", 0], ["15m", 15], ["30m", 30], ["1h", 60], ["2h", 120]];
const DAYS = ["M", "T", "W", "T", "F"];

export default function Builder() {
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm(k, v as never);
    persist();
  };
  const setLeg = (i: number, p: Partial<LegForm>) => {
    setForm("legs", i, p);
    persist();
  };
  const addLeg = () => {
    setForm("legs", (l) => [...l, { side: -1, opt: 0, rank: 0, by: "premium", value: 20, lots: 1 }]);
    persist();
  };
  const removeLeg = (i: number) => {
    setForm("legs", (l) => l.filter((_, k) => k !== i));
    persist();
  };
  return (
    <div class="panel">
      <div class="form">
        <div class="form-in">
        <div class="bt-head">
            <h1 class="bt-title">Strategy</h1>
          <span class="seg">
            <button classList={{ on: builderMode() === "build" }} onClick={() => setBuilderMode("build")}>Builder</button>
            <button classList={{ on: builderMode() === "script" }} onClick={() => setBuilderMode("script")}>Python script</button>
          </span>
          <span class="grow" />
          <Show when={builderMode() === "build"}>
          <button class="tbtn" title="Back to a short straddle" onClick={() => replaceForm(defaultForm())}>
            <RotateCcw />
            Reset
          </button>
          <button class="tbtn key" disabled={running() || form.legs.length === 0} onClick={() => void run().then(() => { if (!btError()) { setResultsView("overview"); setScreen("results"); } })}>
            <Play />
            {running() ? "Running" : "Run backtest"}
          </button>
          </Show>
        </div>
        <Show when={builderMode() === "script"} fallback={<>
        <div class="tpl">
          <span class="cap">Start from</span>
          <For each={TEMPLATES}>
            {(t) => (
              <button class="tbtn chip" onClick={() => replaceForm(t.form())}>
                {t.name}
              </button>
            )}
          </For>
        </div>
        <div class="readback">{describe(form)}</div>
        <Show when={btError()}>
          <div class="notice">{btError()}</div>
        </Show>

        <div class="cols">
        <div class="col">
        <Section title="When to enter" step="enter" note="Skipped: enters once at 09:20">
          <div class="row">
            <Field label="First entry">
              <input class="field" type="time" value={form.from} onInput={(e) => set("from", e.currentTarget.value)} />
            </Field>
            <Field label="Repeat">
              <Seg options={REPEAT} value={form.every} onChange={(v) => set("every", v)} />
            </Field>
            <Show when={form.every > 0}>
              <Field label="Custom (min)">
                <input class="field num" type="number" min="1" max="375" value={form.every} onInput={(e) => set("every", numIn(e.currentTarget.value))} />
              </Field>
              <Field label="Last entry">
                <input class="field" type="time" value={form.until} onInput={(e) => set("until", e.currentTarget.value)} />
              </Field>
              <Field label="Max per day">
                <input class="field num" type="number" min="1" value={form.maxEntries} onInput={(e) => set("maxEntries", numIn(e.currentTarget.value, 1))} />
              </Field>
            </Show>
          </div>
        </Section>

        <Section
          title="Only enter when"
          step="conds"
          note="Skipped: every scheduled entry is taken"
          aside={
            <button
              class="tbtn"
              onClick={() => {
                setForm("conds", (c) => [...(c ?? []), { kind: "from_open", minutes: 30, min: null, max: null } as CondForm]);
                persist();
              }}
            >
              <Plus />
              Add condition
            </button>
          }
        >
          <For each={form.conds}>
            {(c, i) => (
              <div class="condrow">
                <select
                  class="field"
                  aria-label="Condition type"
                  value={c.kind}
                  onChange={(e) => {
                    setForm("conds", i(), "kind", e.currentTarget.value as CondForm["kind"]);
                    persist();
                  }}
                >
                  <For each={COND_KINDS}>{(k) => <option value={k.id}>{k.label}</option>}</For>
                </select>
                <Show when={c.kind === "last_n"}>
                  <span class="unit">
                    <input class="field num" type="number" aria-label="Minutes" min="1" max="375" value={c.minutes} onInput={(e) => { setForm("conds", i(), "minutes", numIn(e.currentTarget.value, 30)); persist(); }} />
                    <span class="quiet">min</span>
                  </span>
                </Show>
                <span class="unit">
                  <span class="quiet">from</span>
                  <input class="field num" type="number" step="0.1" aria-label="Minimum percent" placeholder="any" value={c.min ?? ""} onInput={(e) => { setForm("conds", i(), "min", optNum(e.currentTarget.value)); persist(); }} />
                  <span class="quiet">to</span>
                  <input class="field num" type="number" step="0.1" aria-label="Maximum percent" placeholder="any" value={c.max ?? ""} onInput={(e) => { setForm("conds", i(), "max", optNum(e.currentTarget.value)); persist(); }} />
                  <span class="quiet">%</span>
                </span>
                <button class="tbtn icon" aria-label="Remove condition" onClick={() => { setForm("conds", (l) => l.filter((_, k) => k !== i())); persist(); }}>
                  <Trash2 />
                </button>
              </div>
            )}
          </For>
          <Show when={(form.conds ?? []).length === 0}>
            <div class="quiet cond-none">No conditions: every scheduled entry is taken.</div>
          </Show>
          <Show when={(form.conds ?? []).length > 0}>
            <div class="hint-line">All must hold at the entry minute. Moves are in percent, negative is down. Empty means no limit.</div>
          </Show>
        </Section>

        <Section
          title="Legs"
          required
          aside={
            <button class="tbtn" onClick={addLeg}>
              <Plus />
              Add leg
            </button>
          }
        >
          <For each={form.legs}>
            {(l, i) => (
              <div class="leg" data-side={l.side > 0 ? "buy" : "sell"}>
                <Seg options={[["Sell", -1], ["Buy", 1]]} value={l.side} onChange={(v) => setLeg(i(), { side: v as 1 | -1 })} title="Sell or buy" />
                <Seg options={[["CE", 0], ["PE", 1]]} value={l.opt} onChange={(v) => setLeg(i(), { opt: v as 0 | 1 })} title="Call or put" />
                <Seg options={[["This", 0], ["Next", 1]]} value={l.rank} onChange={(v) => setLeg(i(), { rank: v as 0 | 1 })} title="Which expiry" />
                <select
                  class="field"
                  aria-label="Strike chosen by"
                  value={l.by}
                  onChange={(e) => {
                    const v = e.currentTarget.value as "premium" | "atm";
                    setLeg(i(), { by: v, value: v === "premium" ? 20 : 0 });
                  }}
                >
                  <option value="premium">By premium</option>
                  <option value="atm">By ATM offset</option>
                </select>
                <span class="affix">
                  <input class="field num" type="number" aria-label={l.by === "premium" ? "Premium in rupees" : "Offset in points"} step={l.by === "premium" ? 1 : 50} value={l.value} onInput={(e) => setLeg(i(), { value: numIn(e.currentTarget.value) })} />
                  <span>{l.by === "premium" ? "₹" : "pts"}</span>
                </span>
                <span class="stepper" title="Lots">
                  <button aria-label="Fewer lots" disabled={l.lots <= 1} onClick={() => setLeg(i(), { lots: Math.max(1, l.lots - 1) })}>−</button>
                  <span class="qty">{l.lots} {l.lots === 1 ? "lot" : "lots"}</span>
                  <button aria-label="More lots" onClick={() => setLeg(i(), { lots: l.lots + 1 })}>+</button>
                </span>
                <button class="tbtn icon" aria-label="Remove leg" onClick={() => removeLeg(i())}>
                  <Trash2 />
                </button>
              </div>
            )}
          </For>
          <Show when={form.legs.length === 0}>
            <div class="empty compact"><span class="h">No legs</span><span class="d">Add a leg or pick a template above.</span></div>
          </Show>
          <div class="hint-line">Premium picks the strike priced nearest the amount. ATM offset: positive is further out of the money.</div>
        </Section>

        </div>
        <div class="col">
        <Section title="When to exit" step="exit" note="Skipped: holds to 15:15, no stop loss or target">
          <div class="row">
            <Field label="Exit time">
              <input class="field" type="time" value={form.exitTime} onInput={(e) => set("exitTime", e.currentTarget.value)} />
            </Field>
            <Field label="Stop loss per leg">
              <span class="unit">
                <button class="tbtn chip" classList={{ on: form.slOn }} aria-pressed={form.slOn} onClick={() => set("slOn", !form.slOn)}>{form.slOn ? "On" : "Off"}</button>
                <input class="field num" type="number" min="1" disabled={!form.slOn} value={form.slPct} onInput={(e) => set("slPct", numIn(e.currentTarget.value, 100))} />
                <span class="quiet">% of premium</span>
              </span>
            </Field>
            <Field label="Target per leg">
              <span class="unit">
                <button class="tbtn chip" classList={{ on: form.tgtOn }} aria-pressed={form.tgtOn} onClick={() => set("tgtOn", !form.tgtOn)}>{form.tgtOn ? "On" : "Off"}</button>
                <input class="field num" type="number" min="1" disabled={!form.tgtOn} value={form.tgtPct} onInput={(e) => set("tgtPct", numIn(e.currentTarget.value, 50))} />
                <span class="quiet">% of premium</span>
              </span>
            </Field>
          </div>
        </Section>

        <Section title="Days to test" step="days" note="Skipped: every weekday, from 01-10-2024 to the latest day">
          <div class="row">
            <Field label="Weekdays">
              <span class="seg">
                <For each={DAYS}>
                  {(d, i) => (
                    <button
                      classList={{ on: form.weekdays[i()] }}
                      aria-pressed={form.weekdays[i()]}
                      onClick={() => {
                        setForm("weekdays", i(), !form.weekdays[i()]);
                        persist();
                      }}
                    >
                      {d}
                    </button>
                  )}
                </For>
              </span>
            </Field>
            <Field label="From date">
              <input class="field" type="date" value={form.rangeFrom} onInput={(e) => set("rangeFrom", e.currentTarget.value)} />
            </Field>
            <Field label="To date">
              <input class="field" type="date" value={form.rangeTo} onInput={(e) => set("rangeTo", e.currentTarget.value)} />
            </Field>
          </div>
        </Section>
        </div>
        </div>
        </>}>
          <ScriptPanel />
        </Show>
        </div>
      </div>
    </div>
  );
}
