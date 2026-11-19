import Chain from "./components/Chain";
import Strategy from "./components/Strategy";
import TimeBar from "./components/TimeBar";

/** Simulator: chain on the left, strategy on the right, replay across the bottom. One surface, hairlines between. */
export default function Simulator() {
  return (
    <div class="sim">
      <section class="sim-chain"><Chain /></section>
      <section class="sim-strat"><Strategy /></section>
      <section class="sim-replay"><TimeBar /></section>
    </div>
  );
}
