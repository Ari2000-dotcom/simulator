// Reads a Python-style strategy script into a Form. The script is NEVER executed: it is tokenised and parsed
// into plain data here, so nothing a user pastes can touch files, the network or the machine.
import { defaultForm, type CondForm, type Form, type LegForm } from "./model";

export interface ScriptResult {
  form: Form | null;
  capital: number | null;
  errors: { line: number; msg: string }[];
  warnings: { line: number; msg: string }[];
}

class ScriptError extends Error {
  constructor(public line: number, msg: string) {
    super(msg);
  }
}

// ---------------------------------------------------------------- tokens
type Tok = { t: "num" | "str" | "id" | "op" | "nl" | "eof"; v: string | number; line: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      if (depth === 0) out.push({ t: "nl", v: "\n", line });
      line++;
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      line++;
    } else if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\" && j + 1 < n) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (src[j] !== c) throw new ScriptError(line, "Unterminated string");
      out.push({ t: "str", v: s, line });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9_.]/.test(src[j])) j++;
      if ((src[j] === "e" || src[j] === "E") && /[0-9+-]/.test(src[j + 1] ?? "")) {
        j += 2;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      out.push({ t: "num", v: Number(src.slice(i, j).replaceAll("_", "")), line });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), line });
      i = j;
    } else if ("([{".includes(c)) {
      depth++;
      out.push({ t: "op", v: c, line });
      i++;
    } else if (")]}".includes(c)) {
      depth = Math.max(0, depth - 1);
      out.push({ t: "op", v: c, line });
      i++;
    } else if (",=+-*/:.;".includes(c)) {
      out.push({ t: "op", v: c, line });
      i++;
    } else {
      throw new ScriptError(line, `Unexpected character "${c}"`);
    }
  }
  out.push({ t: "nl", v: "\n", line });
  out.push({ t: "eof", v: "", line });
  return out;
}

// ---------------------------------------------------------------- parser
interface Call {
  call: string;
  args: V[];
  kw: Record<string, V>;
  line: number;
}
type V = number | string | boolean | null | V[] | Call;
const isCall = (v: V): v is Call => typeof v === "object" && v !== null && !Array.isArray(v);

const BAD = new Set(["def", "class", "for", "while", "if", "elif", "else", "with", "try", "except", "lambda", "exec", "eval", "open", "compile", "global", "return", "yield", "async", "await", "del", "raise", "assert", "pass"]);
const IGNORED_CALLS = new Set(["print"]);
const RUN_CALLS = new Set(["strategy", "Strategy", "backtest", "run", "run_backtest", "Backtest"]);
const BUILDERS = new Set(["sell", "buy", "short", "long", "sell_ce", "sell_pe", "buy_ce", "buy_pe", "move_from_open", "move_last", "day_range"]);

class Parser {
  p = 0;
  env: Record<string, V> = {};
  warnings: { line: number; msg: string }[] = [];
  constructor(private toks: Tok[]) {}
  peek = () => this.toks[this.p];
  next = () => this.toks[this.p++];
  isOp = (v: string) => this.peek().t === "op" && this.peek().v === v;
  eat(v: string) {
    if (!this.isOp(v)) throw new ScriptError(this.peek().line, `Expected "${v}"`);
    this.p++;
  }

  program() {
    while (this.peek().t !== "eof") {
      if (this.peek().t === "nl" || this.isOp(";")) {
        this.p++;
        continue;
      }
      this.statement();
    }
  }

  statement() {
    const t = this.peek();
    if (t.t === "id") {
      const name = String(t.v);
      if (name === "import" || name === "from") {
        while (this.peek().t !== "nl" && this.peek().t !== "eof") this.p++;
        return;
      }
      if (BAD.has(name)) throw new ScriptError(t.line, `"${name}" is not supported. Scripts only set values and call sell(...) / buy(...); they are never run.`);
      const nx = this.toks[this.p + 1];
      if (nx.t === "op" && nx.v === "=") {
        this.p += 2;
        this.env[name] = this.expr();
        return this.endStmt();
      }
    }
    const e = this.expr();
    if (isCall(e)) {
      if (RUN_CALLS.has(e.call)) {
        for (const [k, v] of Object.entries(e.kw)) this.env[k] = v;
      } else if (!IGNORED_CALLS.has(e.call)) {
        this.warnings.push({ line: e.line, msg: `"${e.call}(...)" does nothing here and was skipped` });
      }
    }
    this.endStmt();
  }
  endStmt() {
    const t = this.peek();
    if (t.t === "nl" || t.t === "eof" || (t.t === "op" && t.v === ";")) return;
    throw new ScriptError(t.line, `Unexpected "${t.v}"`);
  }

  expr(): V {
    return this.add();
  }
  add(): V {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = String(this.next().v);
      const r = this.mul();
      l = this.bin(op, l, r);
    }
    return l;
  }
  mul(): V {
    let l = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = String(this.next().v);
      const r = this.unary();
      l = this.bin(op, l, r);
    }
    return l;
  }
  bin(op: string, l: V, r: V): V {
    const line = this.peek().line;
    if (typeof l === "number" && typeof r === "number") {
      if (op === "+") return l + r;
      if (op === "-") return l - r;
      if (op === "*") return l * r;
      if (r === 0) throw new ScriptError(line, "Division by zero");
      return l / r;
    }
    if (op === "+" && typeof l === "string" && typeof r === "string") return l + r;
    if (op === "+" && Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
    throw new ScriptError(line, `Cannot use "${op}" on these values`);
  }
  unary(): V {
    if (this.isOp("-")) {
      this.p++;
      const v = this.unary();
      if (typeof v !== "number") throw new ScriptError(this.peek().line, "Only numbers can be negated");
      return -v;
    }
    if (this.isOp("+")) {
      this.p++;
      return this.unary();
    }
    return this.atom();
  }
  atom(): V {
    const t = this.next();
    if (t.t === "num") return t.v as number;
    if (t.t === "str") return t.v as string;
    if (t.t === "op" && t.v === "[") {
      const items: V[] = [];
      while (!this.isOp("]")) {
        items.push(this.expr());
        if (this.isOp(",")) this.p++;
        else break;
      }
      this.eat("]");
      return items;
    }
    if (t.t === "op" && t.v === "(") {
      const first = this.expr();
      if (this.isOp(",")) {
        const items: V[] = [first];
        while (this.isOp(",")) {
          this.p++;
          if (this.isOp(")")) break;
          items.push(this.expr());
        }
        this.eat(")");
        return items;
      }
      this.eat(")");
      return first;
    }
    if (t.t === "id") {
      const name = String(t.v);
      if (name === "True") return true;
      if (name === "False") return false;
      if (name === "None") return null;
      if (this.isOp("(")) return this.call(name, t.line);
      if (name in this.env) return this.env[name];
      throw new ScriptError(t.line, `"${name}" is not defined`);
    }
    throw new ScriptError(t.line, t.t === "nl" || t.t === "eof" ? "Unexpected end of line" : `Unexpected "${t.v}"`);
  }
  call(name: string, line: number): Call {
    if (!BUILDERS.has(name) && !RUN_CALLS.has(name) && !IGNORED_CALLS.has(name)) {
      throw new ScriptError(line, `"${name}(...)" is not available. Use sell, buy, move_from_open, move_last, day_range or strategy.`);
    }
    this.eat("(");
    const args: V[] = [];
    const kw: Record<string, V> = {};
    while (!this.isOp(")")) {
      const t = this.peek();
      const nx = this.toks[this.p + 1];
      if (t.t === "id" && nx.t === "op" && nx.v === "=") {
        this.p += 2;
        kw[String(t.v)] = this.expr();
      } else {
        args.push(this.expr());
      }
      if (this.isOp(",")) this.p++;
      else break;
    }
    this.eat(")");
    return { call: name, args, kw, line };
  }
}

// ---------------------------------------------------------------- interpret into a Form
const ALIAS: Record<string, string> = {
  entry: "from", entry_time: "from", first_entry: "from", start_time: "from",
  repeat: "every", every: "every", interval: "every",
  last_entry: "until", until: "until", end_time: "until",
  max_per_day: "max", max_entries: "max",
  exit: "exit", exit_time: "exit",
  stop_loss: "sl", sl: "sl", stoploss: "sl",
  target: "tgt", tp: "tgt", take_profit: "tgt",
  weekdays: "days", days: "days",
  start: "rangeFrom", from_date: "rangeFrom", start_date: "rangeFrom",
  end: "rangeTo", to_date: "rangeTo", end_date: "rangeTo",
  legs: "legs", only_if: "conds", conditions: "conds", when: "conds",
  capital: "capital",
};

function time(v: V, line: number, what: string): string {
  if (typeof v !== "string") throw new ScriptError(line, `${what} must be a time in quotes, like "09:20"`);
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
  if (!m) throw new ScriptError(line, `${what} "${v}" is not a time like "09:20"`);
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins < 555 || mins > 930) throw new ScriptError(line, `${what} ${v} is outside market hours (09:15 to 15:30)`);
  return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
}
function num(v: V, line: number, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ScriptError(line, `${what} must be a number`);
  return v;
}
function minutes(v: V, line: number): number {
  if (typeof v === "number") return Math.max(0, Math.round(v));
  if (typeof v === "string") {
    const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr)?$/i.exec(v.trim());
    if (m) return Math.round(Number(m[1]) * (m[2] && m[2].toLowerCase().startsWith("h") ? 60 : 1));
  }
  throw new ScriptError(line, 'repeat must be minutes, like 60 or "1h"');
}
function date(v: V, line: number, what: string): string {
  if (v === null || v === "") return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new ScriptError(line, `${what} must look like "2024-10-01"`);
}
function days(v: V, line: number): boolean[] {
  const names = ["mon", "tue", "wed", "thu", "fri"];
  if (typeof v === "string") {
    const s = v.trim();
    if (s.length === 5) return [...s].map((c) => c !== "-" && c !== "." && c !== "_" && c !== " ");
    const parts = s.toLowerCase().split(/[\s,]+/);
    return names.map((n) => parts.some((p) => p.startsWith(n)));
  }
  if (Array.isArray(v)) {
    const on = names.map(() => false);
    for (const x of v) {
      if (typeof x === "number" && x >= 0 && x < 5) on[Math.round(x)] = true;
      else if (typeof x === "string") {
        const i = names.findIndex((n) => x.toLowerCase().startsWith(n));
        if (i >= 0) on[i] = true;
      }
    }
    return on;
  }
  throw new ScriptError(line, 'weekdays must be like "MTWTF" or ["mon", "tue"]');
}
function optOf(s: V, line: number): 0 | 1 {
  if (typeof s === "string") {
    if (/^c/i.test(s)) return 0;
    if (/^p/i.test(s)) return 1;
  }
  throw new ScriptError(line, 'Option type must be "CE" or "PE"');
}
function leg(c: Call): LegForm {
  const buy = c.call === "buy" || c.call === "long" || c.call.startsWith("buy_");
  let opt: 0 | 1;
  if (c.call.endsWith("_ce")) opt = 0;
  else if (c.call.endsWith("_pe")) opt = 1;
  else opt = optOf(c.args[0] ?? c.kw.type ?? c.kw.opt ?? c.kw.option, c.line);
  const extra = c.call.endsWith("_ce") || c.call.endsWith("_pe") ? c.args : c.args.slice(1);
  if (extra.length > 0) throw new ScriptError(c.line, "Name the strike rule: premium=20 or atm=0");
  const hasP = c.kw.premium !== undefined;
  const hasA = c.kw.atm !== undefined || c.kw.offset !== undefined;
  if (hasP === hasA) throw new ScriptError(c.line, `${c.call}(...) needs exactly one of premium=… or atm=…`);
  const ex = c.kw.expiry ?? c.kw.rank ?? 0;
  const rank = ex === 1 || (typeof ex === "string" && /^n/i.test(ex)) ? 1 : 0;
  const lots = c.kw.lots === undefined ? 1 : Math.max(1, Math.round(num(c.kw.lots, c.line, "lots")));
  return {
    side: buy ? 1 : -1,
    opt,
    rank,
    by: hasP ? "premium" : "atm",
    value: hasP ? num(c.kw.premium, c.line, "premium") : num((c.kw.atm ?? c.kw.offset) as V, c.line, "atm"),
    lots,
  };
}
function cond(c: Call): CondForm {
  const lim = (k: string): number | null => (c.kw[k] === undefined || c.kw[k] === null ? null : num(c.kw[k], c.line, k));
  const min = lim("min");
  const max = lim("max");
  if (c.call === "move_from_open") return { kind: "from_open", minutes: 30, min, max };
  if (c.call === "day_range") return { kind: "day_range", minutes: 30, min, max };
  if (c.call === "move_last") {
    const m = c.args[0] ?? c.kw.minutes;
    return { kind: "last_n", minutes: Math.max(1, Math.round(num(m as V, c.line, "minutes"))), min, max };
  }
  throw new ScriptError(c.line, `"${c.call}" is not a condition. Use move_from_open, move_last or day_range.`);
}

export function parseScript(src: string): ScriptResult {
  const res: ScriptResult = { form: null, capital: null, errors: [], warnings: [] };
  if (src.trim() === "") return res;
  if (src.length > 20000) {
    res.errors.push({ line: 1, msg: "Script is too long (limit 20,000 characters)" });
    return res;
  }
  let parser: Parser | null = null;
  try {
    parser = new Parser(lex(src));
    parser.program();
  } catch (e) {
    const err = e instanceof ScriptError ? e : new ScriptError(1, String(e));
    res.errors.push({ line: err.line, msg: err.message });
    return res;
  }
  res.warnings.push(...parser.warnings);
  const f = defaultForm();
  f.legs = [];
  let line = 1;
  const seen: Record<string, boolean> = {};
  try {
    for (const [k, v] of Object.entries(parser.env)) {
      const key = ALIAS[k];
      if (!key) continue; // a helper variable
      seen[key] = true;
      switch (key) {
        case "from": f.from = time(v, line, k); break;
        case "until": f.until = time(v, line, k); break;
        case "exit": f.exitTime = time(v, line, k); break;
        case "every": f.every = minutes(v, line); break;
        case "max": f.maxEntries = Math.max(1, Math.round(num(v, line, k))); break;
        case "sl":
          f.slOn = v !== null && v !== false;
          if (f.slOn) f.slPct = num(v, line, k);
          break;
        case "tgt":
          f.tgtOn = v !== null && v !== false;
          if (f.tgtOn) f.tgtPct = num(v, line, k);
          break;
        case "days": f.weekdays = days(v, line); break;
        case "rangeFrom": f.rangeFrom = date(v, line, k); break;
        case "rangeTo": f.rangeTo = date(v, line, k); break;
        case "capital": res.capital = num(v, line, k); break;
        case "legs": {
          if (!Array.isArray(v)) throw new ScriptError(line, "legs must be a list: legs = [sell(...), buy(...)]");
          f.legs = v.map((x) => {
            if (!isCall(x) || !/^(sell|buy|short|long)/.test(x.call)) throw new ScriptError(line, "Every item in legs must be sell(...) or buy(...)");
            return leg(x);
          });
          break;
        }
        case "conds": {
          if (!Array.isArray(v)) throw new ScriptError(line, "only_if must be a list: only_if = [move_from_open(max=0)]");
          f.conds = v.map((x) => {
            if (!isCall(x)) throw new ScriptError(line, "Every item in only_if must be a condition call");
            return cond(x);
          });
          break;
        }
      }
    }
    if (f.legs.length === 0) throw new ScriptError(1, "No legs found. Add legs = [sell(\"CE\", premium=20), sell(\"PE\", premium=20)]");
    if (f.legs.length > 8) throw new ScriptError(1, "At most 8 legs are supported");
    if (f.every === 0) f.until = f.from;
    else if (!seen.until) {
      f.until = "15:00";
      res.warnings.push({ line: 1, msg: 'last_entry not set: using 15:00' });
    }
    f.use = {
      enter: !!(seen.from || seen.every || seen.until || seen.max),
      conds: !!seen.conds,
      exit: !!(seen.exit || seen.sl || seen.tgt),
      days: !!(seen.days || seen.rangeFrom || seen.rangeTo),
    };
    const toM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    if (toM(f.until) < toM(f.from)) throw new ScriptError(1, "last_entry is before entry");
    if (toM(f.exitTime) <= toM(f.from)) throw new ScriptError(1, "exit must be after entry");
    res.form = f;
  } catch (e) {
    const err = e instanceof ScriptError ? e : new ScriptError(1, String(e));
    res.errors.push({ line: err.line, msg: err.message });
  }
  return res;
}

/** The current builder settings written as a script, so users can copy, tweak and paste it back. */
export function formToScript(f: Form): string {
  const q = (s: string) => JSON.stringify(s);
  const legs = f.legs
    .map((l) => {
      const parts = [q(l.opt === 0 ? "CE" : "PE"), l.by === "premium" ? `premium=${l.value}` : `atm=${l.value}`];
      if (l.lots !== 1) parts.push(`lots=${l.lots}`);
      if (l.rank === 1) parts.push('expiry="next"');
      return `    ${l.side > 0 ? "buy" : "sell"}(${parts.join(", ")}),`;
    })
    .join("\n");
  const conds = (f.conds ?? [])
    .map((c) => {
      const lim = [c.min != null ? `min=${c.min}` : "", c.max != null ? `max=${c.max}` : ""].filter(Boolean);
      return c.kind === "last_n" ? `    move_last(${[String(c.minutes), ...lim].join(", ")}),` : `    ${c.kind === "from_open" ? "move_from_open" : "day_range"}(${lim.join(", ")}),`;
    })
    .join("\n");
  const wd = f.weekdays.map((on, i) => (on ? "MTWTF"[i] : "-")).join("");
  const u = f.use ?? { enter: true, conds: true, exit: true, days: true };
  const lines = [
    ...(u.enter
      ? [`entry = ${q(f.from)}`, f.every > 0 ? `repeat = ${f.every}` : "repeat = 0", ...(f.every > 0 ? [`last_entry = ${q(f.until)}`, `max_per_day = ${f.maxEntries}`] : [])]
      : []),
    ...(u.exit ? [`exit = ${q(f.exitTime)}`, `stop_loss = ${f.slOn ? f.slPct : "None"}`, `target = ${f.tgtOn ? f.tgtPct : "None"}`] : []),
    ...(u.days ? [`weekdays = ${q(wd)}`, `start = ${f.rangeFrom ? q(f.rangeFrom) : "None"}`, `end = ${f.rangeTo ? q(f.rangeTo) : "None"}`] : []),
    `legs = [\n${legs}\n]`,
    ...(u.conds && conds ? [`only_if = [\n${conds}\n]`] : []),
  ];
  return lines.join("\n") + "\n";
}

export const EXAMPLES: { name: string; code: string }[] = [
  {
    name: "Hourly strangle",
    code: `# Sell a ~Rs 20 strangle every hour, stop each leg at 100% loss
entry = "09:20"
repeat = 60
last_entry = "14:20"
exit = "15:15"
stop_loss = 100
premium = 20

legs = [
    sell("CE", premium=premium),
    sell("PE", premium=premium),
]
`,
  },
  {
    name: "Iron fly",
    code: `# Short straddle with bought wings 300 points away
entry = "09:20"
exit = "15:15"
wing = 300

legs = [
    sell("CE", atm=0),
    sell("PE", atm=0),
    buy("CE", atm=wing),
    buy("PE", atm=wing),
]
`,
  },
  {
    name: "After 14:30, calm days only",
    code: `# Late-day strangle, only when the index is within 0.5% of the open
entry = "14:30"
exit = "15:20"
legs = [sell_ce(premium=15), sell_pe(premium=15)]
only_if = [move_from_open(min=-0.5, max=0.5)]
`,
  },
];
