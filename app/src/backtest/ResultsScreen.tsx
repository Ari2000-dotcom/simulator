import { For, Match, Show, Switch } from "solid-js";
import { capital, result, resultsView, setCapital, setResultsView } from "./state";
import Results from "./Results";
import Variations from "./Variations";
import CompareView from "./CompareView";
import { Plus } from "lucide-solid";
import { addForm, compareBusy, entries } from "./compare";
import { form } from "./state";

const SECTIONS: [string, string][] = [
  ["ts-overview", "Overview"],
  ["ts-performance", "Performance"],
  ["ts-risk", "Risk"],
  ["ts-monthly", "Monthly"],
  ["ts-distribution", "Distribution"],
  ["ts-trades", "Trades"],
];
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Results tab: an OpenStatz-style tearsheet, then the sweep of variations. */
export default function ResultsScreen() {
  return (
    <div class="panel">
      <div class="strip">
        <span class="seg">
          <button classList={{ on: resultsView() === "overview" }} onClick={() => setResultsView("overview")}>Tearsheet</button>
          <button classList={{ on: resultsView() === "variations" }} onClick={() => setResultsView("variations")}>Variations</button>
          <button classList={{ on: resultsView() === "compare" }} onClick={() => setResultsView("compare")}>{entries().length > 0 ? "Compare " + entries().length : "Compare"}</button>
        </span>
        <Show when={resultsView() === "overview" && result()}>
          <span class="sep" />
          <nav class="snav">
            <For each={SECTIONS}>{([id, label]) => <button onClick={() => go(id)}>{label}</button>}</For>
          </nav>
        </Show>
        <span class="grow" />
        <Show when={result()}>
          <button class="tbtn" disabled={compareBusy()} title="Keep this strategy to compare with others" onClick={() => void addForm(form).then((ok) => ok && setResultsView("compare"))}>
            <Plus />
            Add to compare
          </button>
        </Show>
        <label class="cap capin">
          Capital ₹
          <input
            class="field num"
            type="number"
            min="1000"
            step="50000"
            value={capital()}
            aria-label="Starting capital in rupees"
            onChange={(e) => e.currentTarget.value && setCapital(Math.max(1000, Number(e.currentTarget.value)))}
          />
        </label>
        <Show when={result()}>
          <span class="cap">Ran in {result()!.ms} ms</span>
        </Show>
      </div>
      <Switch>
        <Match when={resultsView() === "overview"}><Results /></Match>
        <Match when={resultsView() === "variations"}><Variations /></Match>
        <Match when={resultsView() === "compare"}><CompareView /></Match>
      </Switch>
    </div>
  );
}
