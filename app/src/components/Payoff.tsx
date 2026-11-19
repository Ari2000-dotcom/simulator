import { createEffect, onCleanup, onMount } from "solid-js";
import { frame, setWidth, theme, tplus } from "../state";
import { rupees } from "../lib/format";

const ML = 64;
const MR = 12;
const MT = 12;
const MB = 24;
const FONT = '11px "Inter", sans-serif';
const T_STEPS: [string, number][] = [["Now", 0], ["+30m", 30], ["+1h", 60], ["+2h", 120]];

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const wash = (a: number) => `rgb(${css("--qd-wash")} / ${a}%)`;
function niceStep(range: number, target: number) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function PayoffChart() {
  let wrap!: HTMLDivElement;
  let base!: HTMLCanvasElement;
  let over!: HTMLCanvasElement;
  let dpr = 1;
  let geom = { n: 0, w: 0, h: 0 };
  let raf = 0;

  const sizeCanvas = () => {
    dpr = window.devicePixelRatio || 1;
    geom.w = wrap.clientWidth;
    geom.h = wrap.clientHeight;
    for (const c of [base, over]) {
      c.width = Math.max(1, Math.round(geom.w * dpr));
      c.height = Math.max(1, Math.round(geom.h * dpr));
    }
  };

  const draw = () => {
    const f = frame();
    if (!f || geom.w === 0) return;
    const ctx = base.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geom.w, geom.h);
    const n = f.expiry.length;
    if (n < 2) return;
    geom.n = n;
    const x0 = f.xMin;
    const dx = f.dx;
    const xMax = x0 + dx * (n - 1);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, f.expiry[i], f.t0[i]);
      hi = Math.max(hi, f.expiry[i], f.t0[i]);
    }
    if (hi - lo < 1) {
      hi = 1000;
      lo = -1000;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const pw = geom.w - ML - MR;
    const ph = geom.h - MT - MB;
    const X = (x: number) => ML + ((x - x0) / (xMax - x0)) * pw;
    const Y = (y: number) => MT + (1 - (y - lo) / (hi - lo)) * ph;

    const hair = wash(6);
    const tert = css("--qd-text-tertiary");
    ctx.font = FONT;
    ctx.lineWidth = 1;
    // y grid and labels
    const ys = niceStep(hi - lo, 5);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = hair;
      ctx.beginPath();
      ctx.moveTo(ML, y);
      ctx.lineTo(ML + pw, y);
      ctx.stroke();
      ctx.fillStyle = tert;
      ctx.fillText(rupees(v, false), ML - 8, y);
    }
    // x grid and labels
    const xs = niceStep(xMax - x0, 7);
    const tagHalf = (ctx.measureText(`NIFTY ${(f.spot / 100).toFixed(2)}`).width + 12) / 2 + 14;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let v = Math.ceil(x0 / xs) * xs; v <= xMax; v += xs) {
      const x = Math.round(X(v)) + 0.5;
      ctx.strokeStyle = hair;
      ctx.beginPath();
      ctx.moveTo(x, MT);
      ctx.lineTo(x, MT + ph);
      ctx.stroke();
      if (Math.abs(x - (X(f.spot / 100) + 0.5)) < tagHalf) continue; // the spot tag owns this stretch of the axis
      ctx.fillStyle = tert;
      ctx.fillText(String(Math.round(v)), x, MT + ph + 7);
    }
    // zero line
    const zy = Math.round(Y(0)) + 0.5;
    ctx.strokeStyle = css("--qd-strip-edge");
    ctx.beginPath();
    ctx.moveTo(ML, zy);
    ctx.lineTo(ML + pw, zy);
    ctx.stroke();
    // spot: dashed rule with a named tag on the axis
    const sx = Math.round(X(f.spot / 100)) + 0.5;
    ctx.strokeStyle = css("--qd-amber");
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, MT);
    ctx.lineTo(sx, MT + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    const tag = `NIFTY ${(f.spot / 100).toFixed(2)}`;
    const tw = ctx.measureText(tag).width + 12;
    const tx = Math.min(Math.max(sx - tw / 2, ML), ML + pw - tw);
    ctx.fillStyle = css("--qd-amber");
    ctx.fillRect(tx, MT + ph + 4, tw, 17);
    ctx.fillStyle = "#181818";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, tx + tw / 2, MT + ph + 13);

    if (f.legs.length > 0) {
      const pos = css("--qd-positive");
      const neg = css("--qd-negative");
      // T+n curve
      ctx.lineWidth = 1;
      ctx.strokeStyle = css("--qd-accent");
      ctx.beginPath();
      for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(x0 + dx * i), Y(f.t0[i]));
      ctx.stroke();
      // at-expiry curve, coloured by sign
      ctx.lineWidth = 2;
      for (let i = 1; i < n; i++) {
        ctx.strokeStyle = f.expiry[i] + f.expiry[i - 1] >= 0 ? pos : neg;
        ctx.beginPath();
        ctx.moveTo(X(x0 + dx * (i - 1)), Y(f.expiry[i - 1]));
        ctx.lineTo(X(x0 + dx * i), Y(f.expiry[i]));
        ctx.stroke();
      }
      // breakevens, named
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const b of f.stats.be) {
        const x = Math.round(X(b)) + 0.5;
        ctx.fillStyle = css("--qd-text-strong");
        ctx.beginPath();
        ctx.arc(x, zy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = css("--qd-text-secondary");
        ctx.fillText(`BE ${Math.round(b)}`, x, zy - 7);
      }
    }
  };

  const drawOverlay = (px?: number) => {
    const f = frame();
    const ctx = over.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geom.w, geom.h);
    if (px === undefined || !f || f.legs.length === 0 || geom.n < 2) return;
    const pw = geom.w - ML - MR;
    const i = Math.round(Math.max(0, Math.min(1, (px - ML) / pw)) * (geom.n - 1));
    const x = Math.round(ML + (i / (geom.n - 1)) * pw) + 0.5;
    ctx.strokeStyle = css("--qd-text-tertiary");
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, MT);
    ctx.lineTo(x, geom.h - MB);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = `NIFTY ${Math.round(f.xMin + f.dx * i)}   Expiry ${rupees(f.expiry[i])}   T+${tplus()}m ${rupees(f.t0[i])}`;
    ctx.font = FONT;
    const tw = ctx.measureText(text).width + 16;
    const bx = Math.min(Math.max(x - tw / 2, ML), geom.w - MR - tw);
    ctx.fillStyle = css("--qd-surface-3");
    ctx.fillRect(bx, MT, tw, 22);
    ctx.strokeStyle = css("--qd-strip-edge");
    ctx.strokeRect(bx + 0.5, MT + 0.5, tw - 1, 21);
    ctx.fillStyle = css("--qd-text-strong");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 8, MT + 11);
  };

  onMount(() => {
    sizeCanvas();
    let timer = 0;
    const ro = new ResizeObserver(() => {
      sizeCanvas();
      draw();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void setWidth(Math.max(200, Math.round(geom.w - ML - MR))), 150);
    });
    ro.observe(wrap);
    const onTheme = () => draw();
    window.addEventListener("optlab-theme", onTheme);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("optlab-theme", onTheme);
      window.clearTimeout(timer);
    });
  });
  createEffect(() => {
    frame();
    theme();
    draw();
  });

  const onMove = (e: PointerEvent) => {
    const x = e.clientX - over.getBoundingClientRect().left;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      drawOverlay(x);
    });
  };

  return (
    <div class="canvas-wrap" ref={wrap}>
      <canvas ref={base} />
      <canvas ref={over} onPointerMove={onMove} onPointerLeave={() => drawOverlay(undefined)} />
    </div>
  );
}