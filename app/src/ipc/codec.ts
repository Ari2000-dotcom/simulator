// Binary frame v1 decoder. Mirrors crates/engine/src/frame.rs (little-endian).
export const MAGIC = 0x31464c4f;
const HEADER = 64;
const ROW = 52;
const LEG = 40;

export interface SideCell {
  ltp: number; // paise, 0 = no print
  chg: number;
  oi: number;
  doi: number;
  vol: number;
  ivBp: number; // 0 = unknown
  age: number; // minutes since last print, 255 = never
}
export interface ChainRow {
  strike: number; // paise
  ce: SideCell;
  pe: SideCell;
}
export const enum LegStatus {
  Pending = 0,
  Open = 1,
  Exited = 2,
  NoData = 3,
}
export interface LegRow {
  id: number;
  side: number; // +1 / -1
  opt: number; // 0 CE, 1 PE
  rank: number;
  status: LegStatus;
  strike: number;
  offset: number; // index points vs ATM at entry
  lots: number;
  entryT: number;
  exitT: number; // 0xFFFF = none
  entryPx: number;
  ltp: number;
  manual: boolean;
  pnl: number; // rupees
}
export interface Stats {
  netPrem: number;
  maxP: number;
  maxL: number;
  be: number[];
  pnlNow: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}
export interface Frame {
  flags: number;
  date: number;
  t: number;
  rank: number;
  spot: number;
  atm: number;
  fut: number;
  exp0: number;
  exp1: number;
  lot: number;
  stale: number;
  atmRow: number;
  dayPos: number;
  nDays: number;
  xMin: number;
  dx: number;
  fwd: number;
  rows: ChainRow[];
  legs: LegRow[];
  expiry: Float32Array;
  t0: Float32Array;
  stats: Stats;
}

function side(v: DataView, o: number): SideCell {
  return {
    ltp: v.getInt32(o, true),
    chg: v.getInt32(o + 4, true),
    oi: v.getInt32(o + 8, true),
    doi: v.getInt32(o + 12, true),
    vol: v.getInt32(o + 16, true),
    ivBp: v.getUint16(o + 20, true),
    age: v.getUint8(o + 22),
  };
}

export function decodeFrame(buf: ArrayBuffer): Frame {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== MAGIC) throw new Error("bad frame magic");
  if (v.getUint16(4, true) !== 1) throw new Error("unsupported frame version");
  const nRows = v.getUint16(38, true);
  const nLegs = v.getUint16(40, true);
  const nCurve = v.getUint16(42, true);
  const rows: ChainRow[] = new Array(nRows);
  let o = HEADER;
  for (let i = 0; i < nRows; i++, o += ROW) {
    rows[i] = { strike: v.getInt32(o, true), ce: side(v, o + 4), pe: side(v, o + 28) };
  }
  const legs: LegRow[] = new Array(nLegs);
  for (let i = 0; i < nLegs; i++, o += LEG) {
    legs[i] = {
      id: v.getUint32(o, true),
      side: v.getInt8(o + 4),
      opt: v.getUint8(o + 5),
      rank: v.getUint8(o + 6),
      status: v.getUint8(o + 7) as LegStatus,
      strike: v.getInt32(o + 8, true),
      offset: v.getInt16(o + 12, true),
      lots: v.getUint16(o + 14, true),
      entryT: v.getUint16(o + 16, true),
      exitT: v.getUint16(o + 18, true),
      entryPx: v.getInt32(o + 20, true),
      ltp: v.getInt32(o + 24, true),
      manual: v.getUint32(o + 28, true) === 1,
      pnl: v.getFloat64(o + 32, true),
    };
  }
  // copy curves out so they are 4-byte aligned regardless of buffer offset
  const expiry = new Float32Array(nCurve);
  const t0 = new Float32Array(nCurve);
  for (let i = 0; i < nCurve; i++) expiry[i] = v.getFloat32(o + i * 4, true);
  o += nCurve * 4;
  for (let i = 0; i < nCurve; i++) t0[i] = v.getFloat32(o + i * 4, true);
  o += nCurve * 4;
  const stats: Stats = {
    netPrem: v.getFloat64(o, true),
    maxP: v.getFloat64(o + 8, true),
    maxL: v.getFloat64(o + 16, true),
    be: [0, 1, 2, 3].map((i) => v.getFloat32(o + 24 + i * 4, true)).filter((x) => !Number.isNaN(x)),
    pnlNow: v.getFloat64(o + 40, true),
    delta: v.getFloat32(o + 48, true),
    gamma: v.getFloat32(o + 52, true),
    theta: v.getFloat32(o + 56, true),
    vega: v.getFloat32(o + 60, true),
  };
  return {
    flags: v.getUint16(6, true),
    date: v.getInt32(8, true),
    t: v.getUint16(12, true),
    rank: v.getUint16(14, true),
    spot: v.getInt32(16, true),
    atm: v.getInt32(20, true),
    fut: v.getInt32(24, true),
    exp0: v.getInt32(28, true),
    exp1: v.getInt32(32, true),
    lot: v.getUint16(36, true),
    stale: v.getUint16(44, true),
    atmRow: v.getUint16(46, true),
    dayPos: v.getUint16(48, true),
    nDays: v.getUint16(50, true),
    xMin: v.getFloat32(52, true),
    dx: v.getFloat32(56, true),
    fwd: v.getFloat32(60, true),
    rows,
    legs,
    expiry,
    t0,
    stats,
  };
}
