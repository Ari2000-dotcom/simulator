// OpenStatz-style performance statistics, computed from the daily P&L of a backtest.
// Definitions follow QuantStats (which OpenStatz reuses): 252 trading days a year,
// Sharpe = mean / sample std, Sortino = mean / downside deviation, CAGR over calendar time.
export interface DayPnl {
  d: number; // YYYYMMDD
  pnl: number; // rupees
}
export interface Episode {
  start: number;
  trough: number;
  end: number | null; // null = not recovered yet
  depth: number; // negative fraction
  days: number;
}
export interface Tearsheet {
  dates: number[];
  eq: number[]; // equity in rupees, eq[0] is after the first day
  cum: number[]; // cumulative return, fraction
  dd: number[]; // drawdown, negative fraction
  r: number[]; // daily returns, fraction
  total: number;
  cumReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  vol: number;
  maxDd: number;
  calmar: number;
  recovery: number;
  ulcer: number;
  var95: number;
  cvar95: number;
  winRate: number;
  payoff: number | null;
  profitFactor: number | null;
  best: number;
  worst: number;
  avgDay: number;
  maxWinStreak: number;
  maxLossStreak: number;
  months: { y: number; m: number; r: number }[];
  years: { y: number; r: number }[];
  episodes: Episode[];
  years_span: number;
}

const toDate = (d: number) => new Date(Date.UTC(Math.floor(d / 10000), Math.floor((d % 10000) / 100) - 1, d % 100));
const dayDiff = (a: number, b: number) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function tearsheet(daily: DayPnl[], capital: number): Tearsheet | null {
  if (daily.length === 0 || capital <= 0) return null;
  const dates = daily.map((x) => x.d);
  const eq: number[] = [];
  const r: number[] = [];
  let e = capital;
  for (const x of daily) {
    r.push(x.pnl / e);
    e += x.pnl;
    eq.push(e);
  }
  const cum = eq.map((v) => v / capital - 1);
  const dd: number[] = [];
  let peak = capital;
  for (const v of eq) {
    peak = Math.max(peak, v);
    dd.push(v / peak - 1);
  }
  const maxDd = Math.min(0, ...dd);
  const span = Math.max(dayDiff(dates[0], dates[dates.length - 1]), 1) / 365.25;
  const cumReturn = eq[eq.length - 1] / capital - 1;
  const cagr = Math.pow(1 + cumReturn, 1 / Math.max(span, 1 / 252)) - 1;
  const m = mean(r);
  const sd = std(r);
  const down = Math.sqrt(r.filter((v) => v < 0).reduce((s, v) => s + v * v, 0) / r.length);
  const sorted = [...r].sort((a, b) => a - b);
  const var95 = pct(sorted, 0.05);
  const tail = r.filter((v) => v <= var95);
  const wins = daily.filter((x) => x.pnl > 0);
  const losses = daily.filter((x) => x.pnl < 0);
  const gain = wins.reduce((s, x) => s + x.pnl, 0);
  const loss = -losses.reduce((s, x) => s + x.pnl, 0);
  const avgW = wins.length ? gain / wins.length : 0;
  const avgL = losses.length ? loss / losses.length : 0;
  let ws = 0;
  let ls = 0;
  let cw = 0;
  let cl = 0;
  for (const x of daily) {
    cw = x.pnl > 0 ? cw + 1 : 0;
    cl = x.pnl < 0 ? cl + 1 : 0;
    ws = Math.max(ws, cw);
    ls = Math.max(ls, cl);
  }
  // calendar months and years, compounded from the daily returns
  const mm = new Map<string, number>();
  const yy = new Map<number, number>();
  daily.forEach((x, i) => {
    const y = Math.floor(x.d / 10000);
    const mo = Math.floor((x.d % 10000) / 100);
    const k = `${y}-${mo}`;
    mm.set(k, (1 + (mm.get(k) ?? 0)) * (1 + r[i]) - 1);
    yy.set(y, (1 + (yy.get(y) ?? 0)) * (1 + r[i]) - 1);
  });
  const months = [...mm.entries()].map(([k, v]) => ({ y: Number(k.split("-")[0]), m: Number(k.split("-")[1]), r: v }));
  const years = [...yy.entries()].map(([y, v]) => ({ y, r: v })).sort((a, b) => a.y - b.y);
  // drawdown episodes
  const episodes: Episode[] = [];
  let start = -1;
  let trough = 0;
  for (let i = 0; i < dd.length; i++) {
    if (dd[i] < 0) {
      if (start < 0) {
        start = i === 0 ? 0 : i - 1;
        trough = i;
      }
      if (dd[i] < dd[trough]) trough = i;
    } else if (start >= 0) {
      episodes.push({ start: dates[start], trough: dates[trough], end: dates[i], depth: dd[trough], days: dayDiff(dates[start], dates[i]) });
      start = -1;
    }
  }
  if (start >= 0) {
    episodes.push({ start: dates[start], trough: dates[trough], end: null, depth: dd[trough], days: dayDiff(dates[start], dates[dates.length - 1]) });
  }
  episodes.sort((a, b) => a.depth - b.depth);
  return {
    dates,
    eq,
    cum,
    dd,
    r,
    total: eq[eq.length - 1] - capital,
    cumReturn,
    cagr,
    sharpe: sd > 0 ? (m / sd) * Math.sqrt(252) : 0,
    sortino: down > 0 ? (m / down) * Math.sqrt(252) : 0,
    vol: sd * Math.sqrt(252),
    maxDd,
    calmar: maxDd < 0 ? cagr / Math.abs(maxDd) : 0,
    recovery: maxDd < 0 ? cumReturn / Math.abs(maxDd) : 0,
    ulcer: Math.sqrt(mean(dd.map((v) => v * v))),
    var95,
    cvar95: mean(tail),
    winRate: wins.length / daily.length,
    payoff: avgL > 0 ? avgW / avgL : null,
    profitFactor: loss > 0 ? gain / loss : null,
    best: Math.max(...r),
    worst: Math.min(...r),
    avgDay: m,
    maxWinStreak: ws,
    maxLossStreak: ls,
    months,
    years,
    episodes: episodes.slice(0, 5),
    years_span: span,
  };
}

/** Histogram of values into `bins` equal-width buckets. */
export function histogram(v: number[], bins = 24) {
  if (!v.length) return { lo: 0, hi: 0, counts: [] as number[] };
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  return { lo, hi, counts };
}
