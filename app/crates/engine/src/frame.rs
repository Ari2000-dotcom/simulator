//! Binary frame v1 (little-endian). Layout is mirrored by src/ipc/codec.ts.
//!
//! Header 64B | chain rows n*52B | legs n*40B | expiry curve f32*n | t0 curve f32*n | stats 64B
use crate::daybook::{DayBook, Series};
use crate::legs::{Leg, Status};
use crate::pricing::{greeks, implied_vol, intrinsic, price};
use crate::session::{Session, T_MAX};
use crate::store::{days_from_ymd, Store};
use crate::{EXPIRY_MOD, M0, NMIN, STEP};

pub const MAGIC: u32 = 0x3146_4c4f; // "OLF1"
pub const HEADER: usize = 64;
pub const ROW: usize = 52;
pub const LEG: usize = 40;
pub const STATS: usize = 64;

struct W(Vec<u8>);
impl W {
    fn i32(&mut self, v: i32) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn u32(&mut self, v: u32) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn u16(&mut self, v: u16) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn i16(&mut self, v: i16) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn u8(&mut self, v: u8) { self.0.push(v) }
    fn f32(&mut self, v: f32) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn f64(&mut self, v: f64) { self.0.extend_from_slice(&v.to_le_bytes()) }
    fn pad(&mut self, n: usize) { self.0.resize(self.0.len() + n, 0) }
}

/// Years to expiry from minute index `t` of `date` (expiry settles 15:30). Floored to avoid division by zero.
pub fn t_years(date: i32, expiry: i32, t: i32) -> f64 {
    let days = days_from_ymd(expiry) - days_from_ymd(date);
    let mins = days as f64 * 1440.0 + EXPIRY_MOD as f64 - (M0 + t) as f64;
    (mins / (365.0 * 1440.0)).max(1e-7)
}

/// Forward (rupees) for an expiry rank from ATM put-call parity; falls back to spot.
fn forward(book: &DayBook, rank: u8, t: usize) -> f64 {
    let spot = book.spot[t] as f64 / 100.0;
    let atm = book.atm(t);
    for k in 0..6 {
        for sgn in [0i32, 1, -1] {
            if k == 0 && sgn != 0 {
                continue;
            }
            let strike = atm + sgn * k * STEP;
            if let (Some(c), Some(p)) = (book.series(rank, strike, 0), book.series(rank, strike, 1)) {
                if c.c[t] > 0 && p.c[t] > 0 {
                    return strike as f64 / 100.0 + (c.c[t] - p.c[t]) as f64 / 100.0;
                }
            }
        }
    }
    spot
}

#[derive(Clone, Copy)]
struct LegState {
    status: Status,
    ltp: i32,
    pnl: f64,
    iv: f64,
}

fn leg_state(book: &DayBook, s: &Session, leg: &Leg, fwd: &[f64; 2]) -> LegState {
    let t = s.t;
    let Some(ser) = book.series(leg.rank, leg.strike, leg.opt) else {
        return LegState { status: Status::NoData, ltp: 0, pnl: 0.0, iv: 0.0 };
    };
    let t_i = t as u16;
    if t_i < leg.entry_t {
        return LegState { status: Status::Pending, ltp: ser.c[t], pnl: 0.0, iv: 0.0 };
    }
    let (status, at) = match leg.exit_t {
        Some(x) if x <= t_i => (Status::Exited, x as usize),
        _ => (Status::Open, t),
    };
    let ltp = ser.c[at];
    let pnl = leg.side as f64 * (ltp - leg.entry_px) as f64 / 100.0 * leg.lots as f64 * s.lot as f64;
    let exp = book.expiries.get(leg.rank as usize).copied().unwrap_or(0);
    let iv = if exp > 0 && ltp > 0 {
        implied_vol(ltp as f64 / 100.0, fwd[leg.rank as usize & 1], leg.strike as f64 / 100.0, t_years(book.date, exp, at as i32), leg.opt == 0)
            .unwrap_or(0.0)
    } else {
        0.0
    };
    LegState { status, ltp, pnl, iv }
}

fn side_bytes(w: &mut W, ser: Option<&Series>, t: usize, book: &DayBook, rank: u8, strike: i32, call: bool, f: f64) {
    match ser {
        Some(s) if s.c[t] > 0 => {
            let ltp = s.c[t];
            let chg = if s.first_c > 0 { ltp - s.first_c } else { 0 };
            let doi = if s.first_oi > 0 { s.oi[t] - s.first_oi } else { 0 };
            let iv_bp = if s.iv_bp[t] > 0 {
                s.iv_bp[t]
            } else {
                let exp = book.expiries.get(rank as usize).copied().unwrap_or(0);
                if exp > 0 {
                    implied_vol(ltp as f64 / 100.0, f, strike as f64 / 100.0, t_years(book.date, exp, t as i32), call)
                        .map(|v| (v * 10000.0).round().min(65000.0) as u16)
                        .unwrap_or(0)
                } else {
                    0
                }
            };
            w.i32(ltp);
            w.i32(chg);
            w.i32(s.oi[t]);
            w.i32(doi);
            w.i32(s.vol[t]);
            w.u16(iv_bp);
            w.u8(s.age[t]);
            w.u8(0);
        }
        _ => {
            for _ in 0..5 {
                w.i32(0);
            }
            w.u16(0);
            w.u8(255);
            w.u8(0);
        }
    }
}

pub fn build(s: &Session, store: &Store) -> Vec<u8> {
    let mut w = W(Vec::with_capacity(32 * 1024));
    let Some(book) = s.book.as_ref() else {
        w.u32(MAGIC);
        w.pad(HEADER - 4);
        return w.0;
    };
    let t = s.t.min(NMIN - 1);
    let spot_p = book.spot[t];
    let spot = spot_p as f64 / 100.0;
    let atm = book.atm(t);
    let fwd = [forward(book, 0, t), forward(book, 1, t)];
    let rank = s.view.rank.min(1);

    // ---- chain rows ----
    let lo = atm - s.view.half_rows as i32 * STEP;
    let hi = atm + s.view.half_rows as i32 * STEP;
    let strikes: Vec<i32> = book.strikes[rank as usize].iter().copied().filter(|k| *k >= lo && *k <= hi).collect();
    let mut atm_row = 0xFFFFu16;
    let mut stale = 0u16;
    let mut rows = W(Vec::with_capacity(strikes.len() * ROW));
    for (i, k) in strikes.iter().enumerate() {
        if *k == atm {
            atm_row = i as u16;
        }
        rows.i32(*k);
        for opt in 0..2u8 {
            let ser = book.series(rank, *k, opt);
            if ser.map(|x| x.c[t] > 0 && x.age[t] > 5).unwrap_or(false) {
                stale += 1;
            }
            side_bytes(&mut rows, ser, t, book, rank, *k, opt == 0, fwd[rank as usize]);
        }
    }

    // ---- legs ----
    let states: Vec<LegState> = s.legs.iter().map(|l| leg_state(book, s, l, &fwd)).collect();
    let mut legs_w = W(Vec::with_capacity(s.legs.len() * LEG));
    for (l, st) in s.legs.iter().zip(&states) {
        legs_w.u32(l.id);
        legs_w.u8(l.side as u8);
        legs_w.u8(l.opt);
        legs_w.u8(l.rank);
        legs_w.u8(st.status as u8);
        legs_w.i32(l.strike);
        legs_w.i16((l.offset / 100) as i16); // index points
        legs_w.u16(l.lots);
        legs_w.u16(l.entry_t);
        legs_w.u16(l.exit_t.unwrap_or(0xFFFF));
        legs_w.i32(l.entry_px);
        legs_w.i32(st.ltp);
        legs_w.u32(if l.manual { 1 } else { 0 });
        legs_w.f64(st.pnl);
    }

    // ---- payoff curves ----
    let n = (s.view.width_px as usize).clamp(200, 1200);
    let (x_min, x_max) = if s.view.x_max > s.view.x_min {
        (s.view.x_min as f64, s.view.x_max as f64)
    } else {
        (spot * 0.96, spot * 1.04)
    };
    let dx = (x_max - x_min) / (n as f64 - 1.0);
    let lot = s.lot as f64;
    let active: Vec<(&Leg, &LegState)> = s.legs.iter().zip(&states).filter(|(_, st)| st.status == Status::Open || st.status == Status::Exited).collect();
    let nearest_exp = active
        .iter()
        .filter(|(_, st)| st.status == Status::Open)
        .filter_map(|(l, _)| book.expiries.get(l.rank as usize).copied())
        .min();
    let carry = [fwd[0] - spot, fwd[1] - spot];
    let realised: f64 = active.iter().filter(|(_, st)| st.status == Status::Exited).map(|(_, st)| st.pnl).sum();
    let expiry_value = |x: f64| -> f64 {
        let mut y = realised;
        for (l, st) in &active {
            if st.status != Status::Open {
                continue;
            }
            let k = l.strike as f64 / 100.0;
            let call = l.opt == 0;
            let exp = book.expiries.get(l.rank as usize).copied().unwrap_or(0);
            let entry = l.entry_px as f64 / 100.0;
            let mult = l.side as f64 * l.lots as f64 * lot;
            let v = if Some(exp) == nearest_exp || exp == 0 {
                intrinsic(x, k, call)
            } else {
                let dte = (days_from_ymd(exp) - days_from_ymd(nearest_exp.unwrap_or(exp))) as f64 / 365.0;
                if st.iv > 0.0 { price(x + carry[l.rank as usize & 1], k, dte.max(1e-7), st.iv, call) } else { intrinsic(x, k, call) }
            };
            y += mult * (v - entry);
        }
        y
    };
    let mut c_exp = vec![0f32; n];
    let mut c_t0 = vec![0f32; n];
    let t_now_idx = t as i32;
    let t_plus_idx = (t as i32 + s.view.t_plus as i32).min(T_MAX as i32 + 9);
    for i in 0..n {
        let x = x_min + dx * i as f64;
        let (mut ye, mut y0) = (realised, realised);
        for (l, st) in &active {
            if st.status != Status::Open {
                continue;
            }
            let k = l.strike as f64 / 100.0;
            let call = l.opt == 0;
            let r = l.rank as usize & 1;
            let exp = book.expiries.get(l.rank as usize).copied().unwrap_or(0);
            let entry = l.entry_px as f64 / 100.0;
            let mult = l.side as f64 * l.lots as f64 * lot;
            let f_x = x + carry[r];
            let iv = st.iv;
            // at nearest leg expiry
            let ve = if Some(exp) == nearest_exp || exp == 0 {
                intrinsic(x, k, call)
            } else {
                let dte = (days_from_ymd(exp) - days_from_ymd(nearest_exp.unwrap_or(exp))) as f64 / 365.0;
                if iv > 0.0 { price(f_x, k, dte.max(1e-7), iv, call) } else { intrinsic(x, k, call) }
            };
            ye += mult * (ve - entry);
            // T+n now
            let v0 = if iv > 0.0 && exp > 0 {
                price(f_x, k, t_years(book.date, exp, t_plus_idx), iv, call)
            } else {
                intrinsic(x, k, call)
            };
            y0 += mult * (v0 - entry);
        }
        c_exp[i] = ye as f32;
        c_t0[i] = y0 as f32;
    }

    // ---- stats ----
    let mut net_prem = 0.0;
    let mut pnl_now = 0.0;
    let (mut d, mut g, mut th, mut vg) = (0.0, 0.0, 0.0, 0.0);
    for (l, st) in &active {
        net_prem += -(l.side as f64) * (l.entry_px as f64 / 100.0) * l.lots as f64 * lot;
        pnl_now += st.pnl;
        if st.status == Status::Open {
            if let Some(exp) = book.expiries.get(l.rank as usize) {
                if st.iv > 0.0 {
                    let gr = greeks(fwd[l.rank as usize & 1], l.strike as f64 / 100.0, t_years(book.date, *exp, t_now_idx), st.iv, l.opt == 0);
                    let m = l.side as f64 * l.lots as f64 * lot;
                    d += m * gr.delta;
                    g += m * gr.gamma;
                    th += m * gr.theta;
                    vg += m * gr.vega;
                }
            }
        }
    }
    let (mut max_p, mut max_l) = (f64::MIN, f64::MAX);
    for v in &c_exp {
        max_p = max_p.max(*v as f64);
        max_l = max_l.min(*v as f64);
    }
    if active.is_empty() {
        max_p = 0.0;
        max_l = 0.0;
    } else {
        let sl = (c_exp[1] - c_exp[0]) as f64 / dx;
        let sr = (c_exp[n - 1] - c_exp[n - 2]) as f64 / dx;
        // Left side is bounded by spot = 0, so evaluate the payoff there instead of calling it unlimited.
        let y_zero = expiry_value(0.0);
        if sl < -1e-3 {
            max_p = max_p.max(y_zero);
        }
        if sl > 1e-3 {
            max_l = max_l.min(y_zero);
        }
        if sr > 1e-3 {
            max_p = f64::INFINITY;
        }
        if sr < -1e-3 {
            max_l = f64::NEG_INFINITY;
        }
    }
    let mut be = [f32::NAN; 4];
    let mut nb = 0;
    if !active.is_empty() {
        for i in 1..n {
            let (a, b) = (c_exp[i - 1] as f64, c_exp[i] as f64);
            if a == 0.0 && b == 0.0 {
                continue;
            }
            if (a < 0.0 && b >= 0.0) || (a > 0.0 && b <= 0.0) {
                if nb < 4 {
                    let frac = a / (a - b);
                    be[nb] = (x_min + dx * ((i - 1) as f64 + frac)) as f32;
                    nb += 1;
                }
            }
        }
    }

    // ---- assemble ----
    let day_pos = store.day_pos(s.date).unwrap_or(0) as u16;
    let mut flags = 0u16;
    if s.t == 0 {
        flags |= 1;
    }
    if s.t >= T_MAX {
        flags |= 2;
    }
    let mut h = W(Vec::with_capacity(HEADER));
    h.u32(MAGIC);
    h.u16(1);
    h.u16(flags);
    h.i32(s.date);
    h.u16(s.t as u16);
    h.u16(rank as u16);
    h.i32(spot_p);
    h.i32(atm);
    h.i32(book.fut.as_ref().map(|f| f.c[t]).unwrap_or(0));
    h.i32(book.expiries.first().copied().unwrap_or(0));
    h.i32(book.expiries.get(1).copied().unwrap_or(0));
    h.u16(s.lot);
    h.u16(strikes.len() as u16);
    h.u16(s.legs.len() as u16);
    h.u16(n as u16);
    h.u16(stale);
    h.u16(atm_row);
    h.u16(day_pos);
    h.u16(store.days.len() as u16);
    h.f32(x_min as f32); // @52
    h.f32(dx as f32); // @56
    h.f32(fwd[rank as usize] as f32); // @60
    debug_assert_eq!(h.0.len(), HEADER);

    let mut out = h.0;
    out.extend_from_slice(&rows.0);
    out.extend_from_slice(&legs_w.0);
    for v in &c_exp {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in &c_t0 {
        out.extend_from_slice(&v.to_le_bytes());
    }
    let mut st = W(Vec::with_capacity(STATS));
    st.f64(net_prem);
    st.f64(max_p);
    st.f64(max_l);
    for b in be {
        st.f32(b);
    }
    st.f64(pnl_now);
    st.f32(d as f32);
    st.f32(g as f32);
    st.f32(th as f32);
    st.f32(vg as f32);
    debug_assert_eq!(st.0.len(), STATS);
    out.extend_from_slice(&st.0);
    out
}

/// Day spot series as i32[NMIN] bytes (for the scrubber).
pub fn spot_bytes(book: &DayBook) -> Vec<u8> {
    let mut v = Vec::with_capacity(NMIN * 4);
    for x in &book.spot {
        v.extend_from_slice(&x.to_le_bytes());
    }
    v
}
