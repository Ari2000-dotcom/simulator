import { DASH, num, rupees } from "../lib/format";
import { frame } from "../state";

function Cell(props: { label: string; value: string; cls?: string }) {
  return (
    <div class="cellv">
      <div class="cap">{props.label}</div>
      <div class={`v ${props.cls ?? ""}`}>{props.value}</div>
    </div>
  );
}

/** One row of readouts under the payoff chart: a section of the Strategy container. */
export function SummaryRow() {
  const f = frame;
  const s = () => f()!.stats;
  const none = () => !f() || f()!.legs.length === 0;
  return (
    <div class="summary">
      <Cell label={!none() && s().netPrem < 0 ? "Net debit" : "Net credit"} value={none() ? DASH : rupees(Math.abs(s().netPrem), false)} />
      <Cell label="P&L now" value={none() ? DASH : rupees(s().pnlNow)} cls={!none() && s().pnlNow > 0 ? "pos" : !none() && s().pnlNow < 0 ? "neg" : ""} />
      <Cell label="Max profit" value={none() ? DASH : rupees(s().maxP)} cls={none() ? "" : "pos"} />
      <Cell label="Max loss" value={none() ? DASH : rupees(s().maxL)} cls={none() ? "" : "neg"} />
      <Cell label="Breakevens" value={none() || !s().be.length ? DASH : s().be.map((b) => Math.round(b)).join(" / ")} />
      <Cell label="Delta" value={none() ? DASH : num(s().delta, 1, true)} />
      <Cell label="Gamma" value={none() ? DASH : num(s().gamma, 3)} />
      <Cell label="Theta / day" value={none() ? DASH : rupees(s().theta)} />
      <Cell label="Vega / vol pt" value={none() ? DASH : rupees(s().vega)} />
    </div>
  );
}
