import { For, Show } from "solid-js";
import { Minus, Plus, Trash2 } from "lucide-solid";
import { frame, removeLeg, updateLeg } from "../state";
import { LegStatus } from "../ipc/codec";
import { clock, expiryLabel, px, rupees, strike } from "../lib/format";

const offsetLabel = (o: number) => (o === 0 ? "ATM" : o > 0 ? `ATM+${o}` : `ATM${o}`);

/** The legs table: one section of the Strategy container (no container of its own). */
export function LegsTable() {
  const f = frame;
  return (
    <div class="legs">
      <div class="lrow head th">
        <span>#</span><span>Side</span><span>Type</span><span>Strike</span><span>Expiry</span><span>Lots</span>
        <span>Entry</span><span class="r">Price</span><span class="r">LTP</span><span class="r">P&amp;L</span><span class="r">Exit</span>
      </div>
      <Show
        when={f() && f()!.legs.length > 0}
        fallback={<div class="empty compact"><span class="h">No legs</span><span class="d">Hover a chain row and choose B or S.</span></div>}
      >
        <For each={f()!.legs}>
          {(l, i) => (
            <div class="lrow" classList={{ pending: l.status === LegStatus.Pending }}>
              <span class="quiet">{i() + 1}</span>
              <span class={l.side > 0 ? "buy emph" : "sell emph"}>{l.side > 0 ? "B" : "S"}</span>
              <span class={l.opt === 0 ? "call emph" : "put emph"}>{l.opt === 0 ? "CE" : "PE"}</span>
              <span class="strong">{offsetLabel(l.offset)} <span class="quiet">{strike(l.strike)}</span></span>
              <span class="quiet">{expiryLabel(l.rank === 0 ? f()!.exp0 : f()!.exp1, f()!.date)}</span>
              <span class="qty">
                <button class="tbtn icon" aria-label="Fewer lots" disabled={l.lots <= 1} onClick={() => void updateLeg(l.id, { lots: l.lots - 1 })}><Minus /></button>
                <span class="strong qn">{l.lots}</span>
                <button class="tbtn icon" aria-label="More lots" onClick={() => void updateLeg(l.id, { lots: l.lots + 1 })}><Plus /></button>
              </span>
              <span>{l.status === LegStatus.Pending ? "—" : clock(l.entryT)}{l.manual ? "*" : ""}</span>
              <span class="r">{l.status === LegStatus.Pending ? "Pending" : px(l.entryPx)}</span>
              <span class="r">{l.status === LegStatus.Pending ? "" : px(l.ltp)}</span>
              <span class="r" classList={{ pos: l.pnl > 0, neg: l.pnl < 0 }}>{l.status === LegStatus.Pending ? "" : rupees(l.pnl)}</span>
              <span class="act">
                <Show
                  when={l.exitT === 0xffff}
                  fallback={<button class="tbtn chip" title="Remove the exit" onClick={() => void updateLeg(l.id, { exitT: -1 })}>{clock(l.exitT)}</button>}
                >
                  <button class="tbtn chip" title="Exit this leg at the current time" disabled={l.status === LegStatus.Pending} onClick={() => void updateLeg(l.id, { exitT: f()!.t })}>Exit</button>
                </Show>
                <button class="tbtn icon" aria-label="Remove leg" onClick={() => void removeLeg(l.id)}><Trash2 /></button>
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
