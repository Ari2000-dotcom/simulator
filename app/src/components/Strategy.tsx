import { For } from "solid-js";
import { clearLegs, frame, shiftTime, tplus } from "../state";
import { LegsTable } from "./Legs";
import { PayoffChart } from "./Payoff";
import { SummaryRow } from "./Summary";

const T_STEPS: [string, number][] = [["Now", 0], ["+30m", 30], ["+1h", 60], ["+2h", 120]];

/** Legs, payoff and the position readouts in ONE container, as a trader reads them. */
export default function Strategy() {
  const f = frame;
  return (
    <div class="panel">
      <div class="strip">
        <span class="cap">Payoff at</span>
        <span class="seg">
          <For each={T_STEPS}>
            {([label, v]) => <button classList={{ on: tplus() === v }} onClick={() => shiftTime(v)}>{label}</button>}
          </For>
        </span>
        <span class="grow" />
        <span class="cap"><span class="pos">Expiry gain</span> / <span class="neg">loss</span></span>
        <span class="cap legend-t">T+n</span>
        <span class="sep" />
        <button class="tbtn" disabled={!f() || f()!.legs.length === 0} onClick={() => void clearLegs()}>Clear all</button>
      </div>
      <LegsTable />
      <div class="body chart">
        <PayoffChart />
      </div>
      <SummaryRow />
    </div>
  );
}
