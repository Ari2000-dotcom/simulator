import { For, Index, Show, createEffect, on } from "solid-js";
import { addLeg, frame, setRank } from "../state";
import type { ChainRow, SideCell } from "../ipc/codec";
import { compact, compactSigned, expiryLabel, iv, px, pxSigned, strike } from "../lib/format";

function Ltp(props: { cell: SideCell; opt: number; strikeP: number }) {
  const has = () => props.cell.ltp > 0;
  const stale = () => has() && props.cell.age > 5;
  return (
    <span class="cell-ltp" classList={{ stale: stale() }}>
      <Show when={has()}>
        <span class="bs">
          <button class="tbtn tiny b" title="Buy 1 lot" onClick={() => addLeg(1, props.opt, props.strikeP)}>B</button>
          <button class="tbtn tiny s" title="Sell 1 lot" onClick={() => addLeg(-1, props.opt, props.strikeP)}>S</button>
        </span>
      </Show>
      <span class="strong">{px(props.cell.ltp)}{stale() ? "~" : ""}</span>
    </span>
  );
}

const chg = (c: SideCell) => pxSigned(c.chg, c.ltp > 0);
const chgClass = (c: SideCell) => (c.chg > 0 ? "pos" : c.chg < 0 ? "neg" : "quiet");

function Row(props: { row: ChainRow; atm: number; spot: number }) {
  const r = () => props.row;
  const d = (c: SideCell, v: string) => (c.ltp > 0 ? v : "");
  return (
    <div
      class="crow"
      classList={{ atm: r().strike === props.atm, "itm-c": r().strike < props.spot, "itm-p": r().strike > props.spot }}
      data-atm={r().strike === props.atm ? "1" : undefined}
    >
      <span class="quiet">{d(r().ce, compact(r().ce.oi))}</span>
      <span class={r().ce.doi < 0 ? "neg" : "quiet"}>{d(r().ce, compactSigned(r().ce.doi))}</span>
      <span class="quiet">{d(r().ce, compact(r().ce.vol))}</span>
      <span>{d(r().ce, iv(r().ce.ivBp))}</span>
      <span class={chgClass(r().ce)}>{chg(r().ce)}</span>
      <Ltp cell={r().ce} opt={0} strikeP={r().strike} />
      <span class="k">{strike(r().strike)}</span>
      <Ltp cell={r().pe} opt={1} strikeP={r().strike} />
      <span class={chgClass(r().pe)}>{chg(r().pe)}</span>
      <span>{d(r().pe, iv(r().pe.ivBp))}</span>
      <span class="quiet">{d(r().pe, compact(r().pe.vol))}</span>
      <span class={r().pe.doi < 0 ? "neg" : "quiet"}>{d(r().pe, compactSigned(r().pe.doi))}</span>
      <span class="quiet">{d(r().pe, compact(r().pe.oi))}</span>
    </div>
  );
}

export default function Chain() {
  let body!: HTMLDivElement;
  const f = frame;
  const spotIdx = () => {
    const fr = f();
    if (!fr) return -1;
    let j = -1;
    for (let i = 0; i < fr.rows.length; i++) if (fr.rows[i].strike <= fr.spot) j = i;
    return j;
  };
  // centre the ATM row when the day or expiry changes, not on every step
  createEffect(
    on(
      () => [f()?.date, f()?.rank] as const,
      () => {
        queueMicrotask(() => {
          const el = body.querySelector<HTMLElement>('[data-atm="1"]');
          if (el) body.scrollTop = Math.max(0, el.offsetTop - body.clientHeight / 2 + 14);
        });
      },
    ),
  );
  return (
    <div class="panel">
      <div class="strip">
        <span class="seg">
          <For each={[0, 1]}>
            {(r) => (
              <button classList={{ on: f()?.rank === r }} onClick={() => void setRank(r)}>
                {f() ? `Expiry ${expiryLabel(r === 0 ? f()!.exp0 : f()!.exp1, f()!.date)}` : `Expiry ${r + 1}`}
              </button>
            )}
          </For>
        </span>
        <span class="grow" />
        <span class="hint">Hover a row to buy or sell</span>
      </div>
      <div class="chain-x"><div class="chain-in">
      <div class="chain-group th">
        <span class="call">Calls</span>
        <span />
        <span class="put">Puts</span>
      </div>
      <div class="chain-head th">
        <span>OI</span><span>Chg OI</span><span>Volume</span><span>IV</span><span>Chg</span><span>LTP</span>
        <span class="k">Strike</span>
        <span>LTP</span><span>Chg</span><span>IV</span><span>Volume</span><span>Chg OI</span><span>OI</span>
      </div>
      <div class="scroller" ref={body}>
        <Show when={f()} fallback={<div class="empty"><span class="h">Loading day</span></div>}>
          <Index each={f()!.rows}>
            {(row, i) => (
              <>
                <Row row={row()} atm={f()!.atm} spot={f()!.spot} />
                <Show when={i === spotIdx()}>
                  <div class="spotrule"><span>NIFTY {(f()!.spot / 100).toFixed(2)}</span></div>
                </Show>
              </>
            )}
          </Index>
          <Show when={f()!.rows.length === 0}>
            <div class="empty"><span class="h">No contracts</span><span class="d">This expiry has no data for the day.</span></div>
          </Show>
        </Show>
      </div>
      </div></div>
    </div>
  );
}
