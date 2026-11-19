use crate::store::{col_f32, col_i32, read_batches, Store};
use crate::NMIN;
use crate::M0;
use anyhow::Result;
use arrow_array::Array;
use std::collections::HashMap;

/// One contract's minute series for a day. Prices int32 paise. `c`/`oi` are last-observation-carried-forward;
/// `age` = minutes since the last real print (saturating at 255); `c == 0` means no print yet today.
#[derive(Clone)]
pub struct Series {
    pub c: Vec<i32>,
    pub age: Vec<u8>,
    pub oi: Vec<i32>,
    pub vol: Vec<i32>, // cumulative day volume
    pub iv_bp: Vec<u16>, // 0 = unknown
    pub first_c: i32,
    pub first_oi: i32,
}

pub struct DayBook {
    pub date: i32,
    pub spot: Vec<i32>, // LOCF, paise, 0 before first print
    pub expiries: Vec<i32>, // nearest two OPT expiries >= date, ascending
    pub fut: Option<Series>,
    pub fut_expiry: i32,
    pub strikes: [Vec<i32>; 2],
    pub opts: HashMap<(u8, i32, u8), Series>, // (rank, strike, opt 0=CE/1=PE)
    pub n_symbols: usize,
}

struct Raw {
    c: Vec<i32>,
    oi: Vec<i32>,
    vol: Vec<i32>,
    iv: Vec<u16>,
}

fn finish(r: Raw) -> Series {
    let n = NMIN;
    let (mut c, mut age, mut oi, mut vol, mut ivo) = (vec![0; n], vec![0u8; n], vec![0; n], vec![0; n], vec![0u16; n]);
    let (mut lc, mut la, mut lo, mut cum, mut liv) = (0i32, 255u8, 0i32, 0i64, 0u16);
    let (mut first_c, mut first_oi) = (0, 0);
    for t in 0..n {
        if r.c[t] > 0 {
            lc = r.c[t];
            la = 0;
            if first_c == 0 {
                first_c = lc;
            }
            if r.iv[t] > 0 {
                liv = r.iv[t];
            }
        } else if lc > 0 {
            la = la.saturating_add(1);
        }
        if r.oi[t] > 0 {
            lo = r.oi[t];
            if first_oi == 0 {
                first_oi = lo;
            }
        }
        cum += r.vol[t].max(0) as i64;
        c[t] = lc;
        age[t] = if lc > 0 { la } else { 255 };
        oi[t] = lo;
        vol[t] = cum.min(i32::MAX as i64) as i32;
        ivo[t] = liv;
    }
    Series { c, age, oi, vol, iv_bp: ivo, first_c, first_oi }
}

impl DayBook {
    pub fn load(store: &Store, date: i32) -> Result<DayBook> {
        // spot
        let mut spot = vec![0i32; NMIN];
        for b in read_batches(&store.spot_path(date))? {
            let m = col_i32(&b, "m")?;
            let c = col_i32(&b, "c")?;
            for i in 0..b.num_rows() {
                let t = m.value(i) - M0;
                if t >= 0 && (t as usize) < NMIN {
                    spot[t as usize] = c.value(i);
                }
            }
        }
        let mut last = 0;
        for v in spot.iter_mut() {
            if *v > 0 {
                last = *v;
            } else {
                *v = last;
            }
        }
        // bars: first pass collects rows, second maps to series
        let batches = read_batches(&store.bars_path(date))?;
        // expiries seen today
        let mut exps: Vec<i32> = Vec::new();
        let mut fut_exps: Vec<i32> = Vec::new();
        let mut seen: std::collections::HashSet<i32> = std::collections::HashSet::new();
        for b in &batches {
            let sid = col_i32(b, "symbol_id")?;
            for i in 0..b.num_rows() {
                let id = sid.value(i);
                if seen.insert(id) {
                    if let Some(Some(s)) = store.dim.get(id as usize) {
                        if s.expiry >= date {
                            if s.kind == 0 {
                                exps.push(s.expiry);
                            } else {
                                fut_exps.push(s.expiry);
                            }
                        }
                    }
                }
            }
        }
        exps.sort_unstable();
        exps.dedup();
        exps.truncate(2);
        fut_exps.sort_unstable();
        fut_exps.dedup();
        let fut_expiry = fut_exps.first().copied().unwrap_or(0);

        let mut raws: HashMap<(u8, i32, u8), Raw> = HashMap::new();
        let mut fut_raw: Option<Raw> = None;
        let new_raw = || Raw { c: vec![0; NMIN], oi: vec![0; NMIN], vol: vec![0; NMIN], iv: vec![0; NMIN] };
        for b in &batches {
            let sid = col_i32(b, "symbol_id")?;
            let m = col_i32(b, "m")?;
            let c = col_i32(b, "c")?;
            let oi = col_i32(b, "oi")?;
            let vol = col_i32(b, "volume")?;
            let iv = col_f32(b, "iv_bp")?;
            for i in 0..b.num_rows() {
                let t = m.value(i) - M0;
                if t < 0 || t as usize >= NMIN {
                    continue;
                }
                let Some(Some(s)) = store.dim.get(sid.value(i) as usize) else { continue };
                let raw: &mut Raw = if s.kind == 1 {
                    if s.expiry != fut_expiry {
                        continue;
                    }
                    fut_raw.get_or_insert_with(new_raw)
                } else {
                    let Some(rank) = exps.iter().position(|e| *e == s.expiry) else { continue };
                    raws.entry((rank as u8, s.strike, s.opt)).or_insert_with(new_raw)
                };
                let t = t as usize;
                raw.c[t] = c.value(i);
                raw.oi[t] = oi.value(i);
                raw.vol[t] = vol.value(i);
                if iv.is_valid(i) && iv.value(i) > 0.0 {
                    raw.iv[t] = iv.value(i).min(65000.0) as u16;
                }
            }
        }
        let mut strikes: [Vec<i32>; 2] = [Vec::new(), Vec::new()];
        let mut opts = HashMap::with_capacity(raws.len());
        for ((rank, strike, opt), r) in raws {
            if !strikes[rank as usize].contains(&strike) {
                strikes[rank as usize].push(strike);
            }
            opts.insert((rank, strike, opt), finish(r));
        }
        for s in strikes.iter_mut() {
            s.sort_unstable();
        }
        Ok(DayBook { date, spot, expiries: exps, fut: fut_raw.map(finish), fut_expiry, strikes, opts, n_symbols: seen.len() })
    }

    pub fn series(&self, rank: u8, strike: i32, opt: u8) -> Option<&Series> {
        self.opts.get(&(rank, strike, opt))
    }

    /// ATM strike (paise, 50-pt grid) for spot at minute t.
    pub fn atm(&self, t: usize) -> i32 {
        let s = self.spot[t.min(NMIN - 1)];
        ((s as f64 / crate::STEP as f64).round() as i32) * crate::STEP
    }
}
