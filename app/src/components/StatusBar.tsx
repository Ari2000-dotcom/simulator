import { Show } from "solid-js";
import { days, error, frame, loadMs, storeRoot } from "../state";
import { expiryLabel } from "../lib/format";

export default function StatusBar() {
  const f = frame;
  const sparse = () => {
    const d = days().find((x) => x.d === f()?.date);
    return !!d && d.n < 900;
  };
  return (
    <footer class="footer">
      <Show when={error()} fallback={<span>Ready</span>}>
        <span class="err">{error()}</span>
      </Show>
      <span>Day loaded in {loadMs()} ms</span>
      <Show when={f()}>
        <span>Stale quotes {f()!.stale}</span>
        <span>Expiry 1 {expiryLabel(f()!.exp0, f()!.date)}</span>
        <span>Expiry 2 {expiryLabel(f()!.exp1, f()!.date)}</span>
        <span title="Dated lot-size table in the engine config. Not yet checked against NSE circulars.">Lot {f()!.lot} (unverified)</span>
        <Show when={sparse()}>
          <span class="warn">Partial chain on this day</span>
        </Show>
      </Show>
      <span class="grow" />
      <span>{storeRoot()}</span>
    </footer>
  );
}
