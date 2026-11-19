import { invoke } from "@tauri-apps/api/core";
import { decodeFrame, type Frame } from "./codec";

export interface DayInfo {
  d: number;
  n: number;
  wd: string;
}
export interface StoreInfo {
  days: DayInfo[];
  root: string;
}

export const info = () => invoke<StoreInfo>("store_info");
export async function daySpot(): Promise<Int32Array> {
  const buf = await invoke<ArrayBuffer>("day_spot");
  return new Int32Array(buf.slice(0));
}

async function frameCall(cmd: string, args?: Record<string, unknown>): Promise<Frame> {
  return decodeFrame(await invoke<ArrayBuffer>(cmd, args));
}

export const api = {
  openDay: (date: number, keepT = false) => frameCall("open_day", { date, keepT }),
  setClock: (t: number) => frameCall("set_clock", { t }),
  step: (delta: number) => frameCall("step", { delta }),
  setView: (v: { rank?: number; widthPx?: number; xMin?: number; xMax?: number; tPlus?: number; halfRows?: number }) =>
    frameCall("set_view", v),
  legAdd: (side: number, opt: number, rank: number, strike: number, lots = 1) =>
    frameCall("leg_add", { side, opt, rank, strike, lots }),
  legUpdate: (id: number, p: { lots?: number; side?: number; exitT?: number; entryT?: number }) =>
    frameCall("leg_update", { id, ...p }),
  legRemove: (id: number) => frameCall("leg_remove", { id }),
  legsClear: () => frameCall("legs_clear"),
};

/** Latest-wins coordinator: at most one call in flight, extra requests collapse into one pending slot. */
export function latestWins<A extends unknown[]>(fn: (...a: A) => Promise<Frame>, onFrame: (f: Frame) => void) {
  let busy = false;
  let pending: A | null = null;
  const run = async (a: A) => {
    busy = true;
    try {
      onFrame(await fn(...a));
    } finally {
      busy = false;
      if (pending) {
        const p = pending;
        pending = null;
        void run(p);
      }
    }
  };
  return (...a: A) => {
    if (busy) pending = a;
    else void run(a);
  };
}
