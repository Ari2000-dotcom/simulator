import { For, createEffect, onCleanup, onMount } from "solid-js";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-solid";
import { T_MAX, frame, playing, seek, setStepMin, spotSeries, stepBy, stepMin, theme, togglePlay } from "../state";
import { clock } from "../lib/format";
import { LegStatus } from "../ipc/codec";

const STEPS: [string, number][] = [["1m", 1], ["2m", 2], ["5m", 5], ["30m", 30], ["1h", 60], ["2h", 120]];
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function TimeBar() {
  let wrap!: HTMLDivElement;
  let cv!: HTMLCanvasElement;
  let dpr = 1;

  const draw = () => {
    const f = frame();
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!f || w === 0) return;
    dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (t: number) => (t / T_MAX) * (w - 1);
    ctx.font = '11px "Inter", sans-serif';
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (let t = 45; t <= T_MAX; t += 60) {
      const x = Math.round(X(t)) + 0.5;
      ctx.strokeStyle = `rgb(${css("--qd-wash")} / 6%)`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = css("--qd-text-tertiary");
      ctx.fillText(clock(t), x + 4, 3);
    }
    // spot line for the day
    const s = spotSeries();
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t <= T_MAX && t < s.length; t++) {
      if (s[t] > 0) {
        lo = Math.min(lo, s[t]);
        hi = Math.max(hi, s[t]);
      }
    }
    if (hi > lo) {
      ctx.strokeStyle = css("--qd-text-secondary");
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let t = 0; t <= T_MAX; t++) {
        if (s[t] <= 0) continue;
        const y = 16 + (1 - (s[t] - lo) / (hi - lo)) * (h - 22);
        if (!started) {
          ctx.moveTo(X(t), y);
          started = true;
        } else ctx.lineTo(X(t), y);
      }
      ctx.stroke();
    }
    // leg entry and exit marks: buy and sell colours
    for (const l of f.legs) {
      if (l.status === LegStatus.NoData) continue;
      ctx.fillStyle = l.side > 0 ? css("--qd-buy") : css("--qd-sell");
      ctx.fillRect(Math.round(X(Math.min(l.entryT, T_MAX))), h - 7, 2, 7);
      if (l.exitT !== 0xffff) ctx.fillRect(Math.round(X(Math.min(l.exitT, T_MAX))), h - 7, 2, 7);
    }
    // playhead
    const px = Math.round(X(f.t)) + 0.5;
    ctx.strokeStyle = css("--qd-text-strong");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  };

  onMount(() => {
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    const onTheme = () => draw();
    window.addEventListener("optlab-theme", onTheme);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("optlab-theme", onTheme);
    });
  });
  createEffect(() => {
    frame();
    spotSeries();
    theme();
    draw();
  });

  const at = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * T_MAX);
  };
  const onDown = (e: PointerEvent) => {
    cv.setPointerCapture(e.pointerId);
    at(e);
  };
  const onMove = (e: PointerEvent) => {
    if (cv.hasPointerCapture(e.pointerId)) at(e);
  };

  return (
    <div class="panel">
      <div class="strip">
        <span class="plate" title="Time of the current bar">{frame() ? clock(frame()!.t) : "—"}</span>
        <button class="tbtn icon" title="Start of day" onClick={() => seek(0)}><ChevronsLeft /></button>
        <button class="tbtn icon" title="Back one step" disabled={!frame() || frame()!.t <= 0} onClick={() => stepBy(-1)}><ChevronLeft /></button>
        <button class="tbtn icon" title="Forward one step" disabled={!frame() || frame()!.t >= T_MAX} onClick={() => stepBy(1)}><ChevronRight /></button>
        <button class="tbtn icon" title="End of day" onClick={() => seek(T_MAX)}><ChevronsRight /></button>
        <span class="sep" />
        <span class="cap">Step</span>
        <span class="seg">
          <For each={STEPS}>{([label, m]) => <button classList={{ on: stepMin() === m }} onClick={() => setStepMin(m)}>{label}</button>}</For>
        </span>
        <input
          class="field"
          style={{ width: "72px" }}
          inputMode="numeric"
          placeholder="Custom"
          title="Custom step in minutes. Press Enter to apply."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = parseInt(e.currentTarget.value, 10);
              if (v >= 1 && v <= T_MAX) setStepMin(v);
            }
            e.stopPropagation();
          }}
        />
        <span class="quiet">{stepMin()}m</span>
        <span class="grow" />
        <button class="tbtn key" onClick={togglePlay}>{playing() ? <Pause /> : <Play />}{playing() ? "Pause" : "Play"}</button>
      </div>
      <div style={{ padding: "4px 0 0" }}>
        <div class="scrub" ref={wrap}>
          <canvas ref={cv} onPointerDown={onDown} onPointerMove={onMove} />
        </div>
      </div>
    </div>
  );
}
