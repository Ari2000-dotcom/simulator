// The strategy a user builds with the form. Plain data: the engine never runs anything a user typed.
import { invoke } from "@tauri-apps/api/core";

export interface LegForm {
  side: 1 | -1; // 1 buy, -1 sell
  opt: 0 | 1; // 0 CE, 1 PE
  rank: 0 | 1; // 0 this expiry, 1 next
  by: "premium" | "atm";
  value: number; // rupees for premium, index points for ATM offset
  lots: number;
}
export interface CondForm {
  kind: "from_open" | "last_n" | "day_range";
  minutes: number; // only for last_n
  min: number | null; // percent
  max: number | null;
}
export const COND_KINDS: { id: CondForm["kind"]; label: string }[] = [
  { id: "from_open", label: "Index move since the open" },
  { id: "last_n", label: "Index move over the last N minutes" },
  { id: "day_range", label: "Day range so far (high minus low)" },
];
export type StepKey = "enter" | "conds" | "exit" | "days";
export interface Form {
  /** which optional steps are switched on; a step that is off falls back to its defaults */
  use: Record<StepKey, boolean>;
  conds: CondForm[];
  from: string; // "HH:MM"
  every: number; // minutes, 0 = once
  until: string;
  maxEntries: number;
  legs: LegForm[];
  exitTime: string;
  slOn: boolean;
  slPct: number;
  tgtOn: boolean;
  tgtPct: number;
  weekdays: boolean[]; // Mon..Fri
  rangeFrom: string; // "" or YYYY-MM-DD
  rangeTo: string;
}

export interface TradeRow {
  d: number;
  et: number;
  xt: number;
  pnl: number;
  r: number;
  legs: { strike: number; entry: number; exit: number; opt: number; side: number; lots: number; pnl: number }[];
}
export interface Stats {
  trades: number;
  days: number;
  total: number;
  avg: number;
  win_rate: number;
  profit_factor: number | null;
  max_dd: number;
  worst: number;
  best: number;
  skipped_days: number;
  skipped_entries: number;
  blocked_entries?: number;
}
export interface BtResult {
  trades: TradeRow[];
  daily: { d: number; pnl: number }[];
  stats: Stats;
  ms: number;
}

const leg = (side: 1 | -1, opt: 0 | 1, by: "premium" | "atm", value: number): LegForm => ({ side, opt, rank: 0, by, value, lots: 1 });

export const defaultForm = (): Form => ({
  from: "09:20",
  every: 0,
  until: "09:20",
  maxEntries: 99,
  legs: [leg(-1, 0, "atm", 0), leg(-1, 1, "atm", 0)],
  exitTime: "15:15",
  slOn: false,
  slPct: 100,
  tgtOn: false,
  tgtPct: 50,
  use: { enter: true, conds: true, exit: true, days: true },
  conds: [],
  weekdays: [true, true, true, true, true],
  rangeFrom: "2024-10-01", // the store is dense from this date
  rangeTo: "",
});

export interface Template {
  name: string;
  form: () => Form;
}
export const TEMPLATES: Template[] = [
  { name: "Short straddle 09:20", form: defaultForm },
  {
    name: "Hourly ₹20 strangle",
    form: () => ({ ...defaultForm(), from: "09:20", every: 60, until: "14:20", legs: [leg(-1, 0, "premium", 20), leg(-1, 1, "premium", 20)], slOn: true, slPct: 100 }),
  },
  {
    name: "After 14:30 strangle",
    form: () => ({ ...defaultForm(), from: "14:30", until: "14:30", exitTime: "15:20", legs: [leg(-1, 0, "premium", 15), leg(-1, 1, "premium", 15)] }),
  },
  {
    name: "Iron fly 09:20",
    form: () => ({
      ...defaultForm(),
      legs: [leg(-1, 0, "atm", 0), leg(-1, 1, "atm", 0), leg(1, 0, "atm", 300), leg(1, 1, "atm", 300)],
    }),
  },
];

/** The form as it will really run: a switched-off step contributes its defaults, not its stored values. */
export function effective(f: Form): Form {
  const u = f.use ?? { enter: true, conds: true, exit: true, days: true };
  const d = defaultForm();
  return {
    ...f,
    ...(u.enter ? {} : { from: d.from, every: 0, until: d.from, maxEntries: d.maxEntries }),
    conds: u.conds ? f.conds ?? [] : [],
    ...(u.exit ? {} : { exitTime: d.exitTime, slOn: false, tgtOn: false }),
    ...(u.days ? {} : { weekdays: d.weekdays, rangeFrom: d.rangeFrom, rangeTo: "" }),
  };
}

// ---- conversions ----
export function toIdx(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, Math.min(375, h * 60 + m - 555));
}
const dateInt = (s: string) => (s ? Number(s.replaceAll("-", "")) : undefined);

export function toSpec(form: Form) {
  const f = effective(form);
  let mask = 0;
  f.weekdays.forEach((on, i) => {
    if (on) mask |= 1 << i;
  });
  return {
    schedule: { from: toIdx(f.from), every: Math.max(0, Math.round(f.every)), until: toIdx(f.until) },
    legs: f.legs.map((l) => ({
      side: l.side,
      opt: l.opt,
      rank: l.rank,
      lots: Math.max(1, Math.round(l.lots)),
      pick: l.by === "premium" ? { by: "premium", target: l.value } : { by: "atm_offset", points: Math.round(l.value) },
    })),
    exit: { time: toIdx(f.exitTime), sl_pct: f.slOn ? f.slPct : null, tgt_pct: f.tgtOn ? f.tgtPct : null },
    limits: { max_entries: Math.max(1, Math.round(f.maxEntries)), weekdays: mask },
    conditions: (f.conds ?? []).map((c) => {
      const lim = { min: c.min ?? null, max: c.max ?? null };
      return c.kind === "last_n" ? { kind: c.kind, minutes: Math.max(1, Math.round(c.minutes)), ...lim } : { kind: c.kind, ...lim };
    }),
    range: { from: dateInt(f.rangeFrom) ?? null, to: dateInt(f.rangeTo) ?? null },
  };
}

/** One-line read-back so the user sees what will be tested. */
export function describe(form: Form): string {
  const f = effective(form);
  const legs = f.legs
    .map((l) => {
      const pick = l.by === "premium" ? `≈ ₹${l.value} premium` : l.value === 0 ? "ATM" : `ATM ${l.value > 0 ? "+" : ""}${l.value}`;
      return `${l.side > 0 ? "buy" : "sell"} ${l.lots > 1 ? l.lots + " lots " : ""}${l.opt === 0 ? "CE" : "PE"} ${pick}${l.rank ? " (next expiry)" : ""}`;
    })
    .join(", ");
  const when =
    f.every > 0 ? `every ${f.every >= 60 && f.every % 60 === 0 ? f.every / 60 + "h" : f.every + "m"} from ${f.from} to ${f.until}` : `at ${f.from}`;
  const exits = [`exit ${f.exitTime}`, f.slOn ? `stop loss ${f.slPct}% per leg` : "", f.tgtOn ? `target ${f.tgtPct}% per leg` : ""].filter(Boolean).join(", ");
  const rng = (c: CondForm) => (c.min != null && c.max != null ? `between ${c.min}% and ${c.max}%` : c.min != null ? `at least ${c.min}%` : c.max != null ? `at most ${c.max}%` : "any");
  const conds = (f.conds ?? [])
    .map((c) => (c.kind === "from_open" ? `index move since open ${rng(c)}` : c.kind === "last_n" ? `index move over ${c.minutes}m ${rng(c)}` : `day range ${rng(c)}`))
    .join(" and ");
  return `${when}${conds ? `, only if ${conds}` : ""}: ${legs}. ${exits}.`;
}

export async function runBacktest(f: Form): Promise<BtResult> {
  return await invoke<BtResult>("bt_run", { spec: toSpec(f) });
}
