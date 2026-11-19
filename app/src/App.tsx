import { onCleanup, onMount } from "solid-js";
import TopBar from "./components/TopBar";
import StatusBar from "./components/StatusBar";
import { Match, Switch } from "solid-js";
import Simulator from "./Simulator";
import Builder from "./backtest/Builder";
import ResultsScreen from "./backtest/ResultsScreen";
import { T_MAX, boot, screen, gotoDay, seek, setStepMin, stepBy, togglePlay } from "./state";

const STEP_KEYS: Record<string, number> = { "1": 1, "2": 2, "3": 5, "4": 30, "5": 60, "6": 120 };

export default function App() {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
    if (screen() !== "simulator") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight":
        stepBy(1, e.shiftKey ? 1 : undefined);
        break;
      case "ArrowLeft":
        stepBy(-1, e.shiftKey ? 1 : undefined);
        break;
      case " ":
        togglePlay();
        break;
      case "Home":
        seek(0);
        break;
      case "End":
        seek(T_MAX);
        break;
      case "[":
        gotoDay(-1);
        break;
      case "]":
        gotoDay(1);
        break;
      default:
        if (STEP_KEYS[e.key]) setStepMin(STEP_KEYS[e.key]);
        else return;
    }
    e.preventDefault();
  };
  onMount(() => {
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
    void boot();
  });
  return (
    <div class="app">
      <TopBar />
      <main class="screen">
        <Switch>
          <Match when={screen() === "simulator"}><Simulator /></Match>
          <Match when={screen() === "backtest"}><Builder /></Match>
          <Match when={screen() === "results"}><ResultsScreen /></Match>
        </Switch>
      </main>
      <StatusBar />
    </div>
  );
}
