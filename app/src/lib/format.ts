const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const DASH = "—";

export function px(paise: number): string {
  return paise > 0 ? (paise / 100).toFixed(2) : DASH;
}
export function pxSigned(paise: number, show = true): string {
  if (!show) return DASH;
  const v = paise / 100;
  return (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(2);
}
export function strike(paise: number): string {
  return String(Math.round(paise / 100));
}
/** Compact fixed-width Indian units: 9,999 / 12.3K / 4.56L / 1.23Cr. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a < 10000) return s + String(a);
  if (a < 100000) return s + (a / 1000).toFixed(1) + "K";
  if (a < 10000000) return s + (a / 100000).toFixed(2) + "L";
  return s + (a / 10000000).toFixed(2) + "Cr";
}
export function compactSigned(n: number): string {
  return n > 0 ? "+" + compact(n) : compact(n);
}
export function iv(bp: number): string {
  return bp > 0 ? (bp / 100).toFixed(1) : DASH;
}
/** Indian digit grouping, no decimals, explicit sign. */
export function rupees(v: number, sign = true): string {
  if (!Number.isFinite(v)) return v > 0 ? "UNLTD" : "-UNLTD";
  const r = Math.round(Math.abs(v));
  let s = String(r);
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    s = rest + "," + last3;
  }
  const sg = v < 0 && r !== 0 ? "-" : sign && r !== 0 ? "+" : "";
  return sg + s;
}
export function num(v: number, dp = 2, sign = false): string {
  if (!Number.isFinite(v)) return DASH;
  const s = v.toFixed(dp);
  return sign && v > 0 ? "+" + s : s;
}
/** Minute index (0 = 09:15) to HH:MM. */
export function clock(t: number): string {
  const m = 555 + t;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
export function dateLabel(d: number, wd = ""): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const dd = d % 100;
  return `${wd ? wd + " " : ""}${String(dd).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}
export function dateIso(d: number): string {
  return `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;
}
export function isoToInt(s: string): number {
  return Number(s.replaceAll("-", ""));
}
export function daysBetween(a: number, b: number): number {
  const ms = (x: number) => Date.UTC(Math.floor(x / 10000), (Math.floor(x / 100) % 100) - 1, x % 100);
  return Math.round((ms(b) - ms(a)) / 86400000);
}
export function expiryLabel(exp: number, day: number): string {
  if (!exp) return DASH;
  const m = Math.floor(exp / 100) % 100;
  return `${String(exp % 100).padStart(2, "0")}-${MONTHS[m - 1]} ${daysBetween(day, exp)}D`;
}
