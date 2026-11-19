import { Show } from "solid-js";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-solid";
import { days, frame, gotoDay, jumpToDate, screen, setScreen, setTheme, spotSeries, theme } from "../state";
import { dateIso, dateLabel, isoToInt, px } from "../lib/format";

/** Nav bar: brand, screens, the day's subject quote, date controls. */
export default function TopBar() {
  const f = frame;
  const wd = () => days().find((d) => d.d === f()?.date)?.wd ?? "";
  const first = () => days()[0]?.d ?? 20000101;
  const last = () => days()[days().length - 1]?.d ?? 20991231;
  // day move: points, then percent in brackets (QuantDesk's way)
  const move = () => {
    const s = spotSeries();
    const fr = f();
    if (!fr || s.length === 0 || s[0] <= 0) return null;
    const d = fr.spot - s[0];
    const sign = d > 0 ? "+" : d < 0 ? "-" : "";
    return { text: `${sign}${Math.abs(d / 100).toFixed(2)} (${sign}${Math.abs((d / s[0]) * 100).toFixed(2)}%)`, cls: d > 0 ? "pos" : d < 0 ? "neg" : "quiet" };
  };
  return (
    <header class="nav">
      <span class="subject" style={{ "letter-spacing": "0.02em" }}>OPTLAB</span>
      <span class="seg">
        <button classList={{ on: screen() === "simulator" }} onClick={() => setScreen("simulator")}>Simulator</button>
        <button classList={{ on: screen() === "backtest" }} onClick={() => setScreen("backtest")}>Backtesting</button>
        <button classList={{ on: screen() === "results" }} onClick={() => setScreen("results")}>Results</button>
      </span>
      <span class="grow" />
      <Show when={f()}>
        <span class="strong emph">NIFTY</span>
        <span class="strong emph">{px(f()!.spot)}</span>
        <Show when={move()}>
          <span class={move()!.cls}>{move()!.text}</span>
        </Show>
        <span class="sep" />
        <span class="cap">ATM</span><span class="strong">{Math.round(f()!.atm / 100)}</span>
        <span class="cap">Fut</span><span class="strong">{px(f()!.fut)}</span>
        <span class="cap">Fwd</span><span class="strong">{f()!.fwd.toFixed(2)}</span>
      </Show>
      <span class="sep" />
      <button class="tbtn icon" title="Previous trading day" onClick={() => gotoDay(-1)}><ChevronLeft /></button>
      <Show when={f()}>
        <span class="strong">{dateLabel(f()!.date, wd())}</span>
        <input
          class="field"
          type="date"
          value={dateIso(f()!.date)}
          min={dateIso(first())}
          max={dateIso(last())}
          style={{ width: "132px" }}
          title="Jump to a date"
          onChange={(e) => e.currentTarget.value && jumpToDate(isoToInt(e.currentTarget.value))}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Show>
      <button class="tbtn icon" title="Next trading day" onClick={() => gotoDay(1)}><ChevronRight /></button>
      <span class="sep" />
      <button class="tbtn icon" title={theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme() === "dark" ? "light" : "dark")}>
        {theme() === "dark" ? <Sun /> : <Moon />}
      </button>
    </header>
  );
}
