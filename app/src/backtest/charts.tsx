import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { theme } from "../state";
import { dateLabel } from "../lib/format";
import { histogram, type Tearsheet } from "./tearsheet";

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ML = 56;
const MR = 12;
const MT = 10;
const MB = 22;
export const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function niceStep(range: number, target: number) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** One series over dates: filled line with a hover read-out. Canvas, redrawn on resize and theme. */
export function Chart(props: { dates: number[]; ys: number[]; color: string; fmt: (v: number) => string; height: number; fill?: boolean }) {
  let wrap!: HTMLDivElement;
  let cv!: HTMLCanvasElement;
  const [hover, setHover] = createSignal<{ x: number; i: number } | null>(null);
  const geom = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const lo0 = Math.min(0, ...props.ys);
    const hi0 = Math.max(0, ...props.ys);
    const pad = (hi0 - lo0 || 1) * 0.08;
    const lo = lo0 === 0 ? 0 : lo0 - pad;
    const hi = hi0 === 0 ? 0 : hi0 + pad;
    const pw = w - ML - MR;
    const ph = h - MT - MB;
    const n = props.ys.length;
    return {
      w, h, lo, hi, pw, ph, n,
      X: (i: number) => ML + (n === 1 ? pw / 2 : (i / (n - 1)) * pw),
      Y: (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * ph,
    };
  };
  const draw = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || props.ys.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = geom();
    const color = css(props.color) || props.color;
    ctx.font = '11px "Inter", sans-serif';
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const span = g.hi - g.lo || 1;
    const step = niceStep(span, 4);
    for (let v = Math.ceil(g.lo / step) * step; v <= g.hi + 1e-12; v += step) {
      const y = Math.round(g.Y(v)) + 0.5;
      ctx.strokeStyle = `rgb(${css("--qd-wash")} / 7%)`;
      ctx.beginPath();
      ctx.moveTo(ML, y);
      ctx.lineTo(ML + g.pw, y);
      ctx.stroke();
      ctx.fillStyle = css("--qd-text-tertiary");
      ctx.fillText(props.fmt(v), ML - 8, y);
    }
    const zy = g.Y(0);
    if (props.fill !== false) {
      ctx.beginPath();
      ctx.moveTo(g.X(0), zy);
      for (let i = 0; i < g.n; i++) ctx.lineTo(g.X(i), g.Y(props.ys[i]));
      ctx.lineTo(g.X(g.n - 1), zy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < g.n; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, g.X(i), g.Y(props.ys[i]));
    ctx.stroke();
    ctx.fillStyle = css("--qd-text-tertiary");
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(dateLabel(props.dates[0]), ML, MT + g.ph + 6);
    ctx.textAlign = "right";
    ctx.fillText(dateLabel(props.dates[g.n - 1]), ML + g.pw, MT + g.ph + 6);
  };
  onMount(() => {
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => {
    props.ys;
    theme();
    draw();
  });
  const onMove = (e: MouseEvent) => {
    const rect = wrap.getBoundingClientRect();
    const g = geom();
    const x = e.clientX - rect.left;
    const i = Math.round(((x - ML) / g.pw) * (g.n - 1));
    setHover(i >= 0 && i < g.n ? { x: g.X(i), i } : null);
  };
  return (
    <div class="chart" style={{ height: `${props.height}px` }} ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={cv} />
      {hover() && (
        <>
          <div class="chart-rule" style={{ left: `${hover()!.x}px`, top: `${MT}px`, bottom: `${MB}px` }} />
          <div class="chart-tip" style={{ left: `${Math.min(hover()!.x + 10, (wrap?.clientWidth ?? 600) - 150)}px` }}>
            <span class="cap">{dateLabel(props.dates[hover()!.i])}</span>
            <b>{props.fmt(props.ys[hover()!.i])}</b>
          </div>
        </>
      )}
    </div>
  );
}

/** Calendar heatmap: years down, months across, intensity grows with the size of the move. */
export function MonthlyHeatmap(props: { t: Tearsheet }) {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const years = () => props.t.years.map((y) => y.y);
  const maxAbs = () => Math.max(...props.t.months.map((m) => Math.abs(m.r)), 1e-9);
  const cell = (y: number, m: number) => props.t.months.find((x) => x.y === y && x.m === m)?.r;
  const bg = (v: number | undefined) =>
    v === undefined ? "transparent" : `rgb(var(${v >= 0 ? "--qd-positive-rgb" : "--qd-negative-rgb"}) / ${Math.round(8 + 52 * Math.min(1, Math.abs(v) / maxAbs()))}%)`;
  return (
    <div class="mheat">
      <span />
      <For each={MON}>{(m) => <span class="th mh-c">{m}</span>}</For>
      <span class="th mh-c">Year</span>
      <For each={years()}>
        {(y) => (
          <>
            <span class="th mh-y">{y}</span>
            <For each={MON}>
              {(_, mi) => {
                const v = () => cell(y, mi() + 1);
                return <span class="mh-cell" style={{ background: bg(v()) }}>{v() === undefined ? "" : (v()! * 100).toFixed(1)}</span>;
              }}
            </For>
            <span class="mh-cell mh-year" classList={{ pos: (props.t.years.find((q) => q.y === y)?.r ?? 0) > 0, neg: (props.t.years.find((q) => q.y === y)?.r ?? 0) < 0 }}>
              {((props.t.years.find((q) => q.y === y)?.r ?? 0) * 100).toFixed(1)}
            </span>
          </>
        )}
      </For>
    </div>
  );
}

/** Histogram of daily returns: bars right of zero are green, left are red. */
export function Distribution(props: { r: number[] }) {
  const h = () => histogram(props.r, 28);
  const peak = () => Math.max(...h().counts, 1);
  const w = () => (h().hi - h().lo) / (h().counts.length || 1);
  return (
    <div class="dist">
      <div class="dist-bars">
        <For each={h().counts}>
          {(c, i) => {
            const mid = () => h().lo + (i() + 0.5) * w();
            return <span class="dist-bar" classList={{ up: mid() >= 0, dn: mid() < 0 }} style={{ height: `${(c / peak()) * 100}%` }} title={`${c} days`} />;
          }}
        </For>
      </div>
      <div class="dist-ax">
        <span class="cap">{pct1(h().lo)}</span>
        <span class="cap">{pct1(h().hi)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- several series on one time axis
export interface Line {
  name: string;
  color: string; // css var name (--x) or a colour
  dates: number[];
  ys: number[];
}
const dayNum = (d: number) => Date.UTC(Math.floor(d / 10000), Math.floor((d % 10000) / 100) - 1, d % 100) / 86400000;
const resolve = (c: string) => (c.startsWith("--") ? css(c) : c);

export function MultiChart(props: { lines: Line[]; fmt: (v: number) => string; height: number }) {
  let wrap!: HTMLDivElement;
  let cv!: HTMLCanvasElement;
  const [hover, setHover] = createSignal<{ x: number; day: number } | null>(null);
  const bounds = () => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let lo = 0;
    let hi = 0;
    for (const l of props.lines) {
      if (l.dates.length === 0) continue;
      x0 = Math.min(x0, dayNum(l.dates[0]));
      x1 = Math.max(x1, dayNum(l.dates[l.dates.length - 1]));
      for (const y of l.ys) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    const pad = (hi - lo || 1) * 0.08;
    return { x0, x1: x1 === x0 ? x0 + 1 : x1, lo: lo === 0 ? 0 : lo - pad, hi: hi === 0 ? 0 : hi + pad };
  };
  const draw = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || props.lines.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const b = bounds();
    const pw = w - ML - MR;
    const ph = h - MT - MB;
    const X = (d: number) => ML + ((dayNum(d) - b.x0) / (b.x1 - b.x0)) * pw;
    const Y = (v: number) => MT + (1 - (v - b.lo) / (b.hi - b.lo || 1)) * ph;
    ctx.font = '11px "Inter", sans-serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const step = niceStep(b.hi - b.lo || 1, 4);
    for (let v = Math.ceil(b.lo / step) * step; v <= b.hi + 1e-12; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = `rgb(${css("--qd-wash")} / 7%)`;
      ctx.beginPath();
      ctx.moveTo(ML, y);
      ctx.lineTo(ML + pw, y);
      ctx.stroke();
      ctx.fillStyle = css("--qd-text-tertiary");
      ctx.fillText(props.fmt(v), ML - 8, y);
    }
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    for (const l of props.lines) {
      ctx.strokeStyle = resolve(l.color);
      ctx.beginPath();
      l.dates.forEach((d, i) => (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(d), Y(l.ys[i])));
      ctx.stroke();
    }
    const first = Math.min(...props.lines.filter((l) => l.dates.length).map((l) => l.dates[0]));
    const last = Math.max(...props.lines.filter((l) => l.dates.length).map((l) => l.dates[l.dates.length - 1]));
    ctx.fillStyle = css("--qd-text-tertiary");
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(dateLabel(first), ML, MT + ph + 6);
    ctx.textAlign = "right";
    ctx.fillText(dateLabel(last), ML + pw, MT + ph + 6);
  };
  onMount(() => {
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => {
    props.lines;
    theme();
    draw();
  });
  const onMove = (e: MouseEvent) => {
    const b = bounds();
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pw = wrap.clientWidth - ML - MR;
    const day = b.x0 + ((x - ML) / pw) * (b.x1 - b.x0);
    setHover(x >= ML && x <= ML + pw ? { x, day } : null);
  };
  // value of a line at a day: the last point on or before it
  const at = (l: Line, day: number) => {
    let v: number | null = null;
    for (let i = 0; i < l.dates.length; i++) {
      if (dayNum(l.dates[i]) <= day) v = l.ys[i];
      else break;
    }
    return v;
  };
  const when = () => {
    const h = hover();
    if (!h) return "";
    const d = new Date(h.day * 86400000);
    return dateLabel(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
  };
  return (
    <div class="chart" style={{ height: `${props.height}px` }} ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={cv} />
      {hover() && (
        <>
          <div class="chart-rule" style={{ left: `${hover()!.x}px`, top: `${MT}px`, bottom: `${MB}px` }} />
          <div class="chart-tip" style={{ left: `${Math.min(hover()!.x + 12, (wrap?.clientWidth ?? 600) - 220)}px` }}>
            <span class="cap">{when()}</span>
            <For each={props.lines}>
              {(l) => {
                const v = () => at(l, hover()!.day);
                return (
                  <span class="tip-row">
                    <i class="dot" style={{ background: resolve(l.color) }} />
                    <span class="tip-n">{l.name}</span>
                    <b>{v() === null ? "—" : props.fmt(v()!)}</b>
                  </span>
                );
              }}
            </For>
          </div>
        </>
      )}
    </div>
  );
}
