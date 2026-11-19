//! Rule-based intraday backtest over the memory-mapped cubes.
//! A strategy is a plain data spec (schedule + legs + exit + limits). Nothing in a spec is executable code.
use crate::config::{lot_size, store_root};
use crate::store::days_from_ymd;
use crate::{NMIN, STEP};
use anyhow::{anyhow, Context, Result};
use memmap2::Mmap;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;

// ---------------------------------------------------------------- spec

#[derive(Deserialize, Clone, Debug)]
pub struct Spec {
    pub schedule: Schedule,
    pub legs: Vec<LegSpec>,
    pub exit: ExitSpec,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default)]
    pub range: Range,
    /// every condition must hold at an entry minute, otherwise that entry is skipped
    #[serde(default)]
    pub conditions: Vec<Cond>,
}

/// A rule on the index at the entry minute. Moves are in percent of the reference spot.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Cond {
    /// spot now versus the first spot of the day
    FromOpen { min: Option<f64>, max: Option<f64> },
    /// spot now versus `minutes` ago
    LastN { minutes: u16, min: Option<f64>, max: Option<f64> },
    /// high minus low so far today, percent of spot
    DayRange { min: Option<f64>, max: Option<f64> },
}

fn within(v: f64, min: Option<f64>, max: Option<f64>) -> bool {
    min.map(|m| v >= m).unwrap_or(true) && max.map(|m| v <= m).unwrap_or(true)
}

/// Minute indices: 0 = 09:15 ... 375 = 15:30.
#[derive(Deserialize, Clone, Debug)]
pub struct Schedule {
    pub from: u16,
    #[serde(default)]
    pub every: u16, // 0 = a single entry
    pub until: u16,
}

#[derive(Deserialize, Clone, Debug)]
pub struct LegSpec {
    pub side: i8, // +1 buy, -1 sell
    pub opt: u8,  // 0 CE, 1 PE
    #[serde(default)]
    pub rank: u8, // 0 = nearest expiry, 1 = next
    pub pick: Pick,
    #[serde(default = "one")]
    pub lots: u16,
}
fn one() -> u16 {
    1
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "by", rename_all = "snake_case")]
pub enum Pick {
    /// strike whose premium (rupees) is closest to `target`
    Premium { target: f64 },
    /// strike `points` away from ATM at the entry minute (CE: positive = OTM)
    AtmOffset { points: i32 },
}

#[derive(Deserialize, Clone, Debug)]
pub struct ExitSpec {
    pub time: u16,
    /// close a leg when it has lost this % of its entry premium (sell: premium up, buy: premium down)
    pub sl_pct: Option<f64>,
    /// close a leg when it has gained this % of its entry premium
    pub tgt_pct: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Limits {
    #[serde(default = "six")]
    pub max_entries: u16,
    /// bit0 = Monday ... bit4 = Friday
    #[serde(default = "all_days")]
    pub weekdays: u8,
    pub dte_min: Option<i32>,
    pub dte_max: Option<i32>,
}
fn six() -> u16 {
    99
}
fn all_days() -> u8 {
    0b11111
}
impl Default for Limits {
    fn default() -> Self {
        Limits { max_entries: six(), weekdays: all_days(), dte_min: None, dte_max: None }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct Range {
    pub from: Option<i32>,
    pub to: Option<i32>,
}

// ---------------------------------------------------------------- result

#[derive(Serialize, Debug)]
pub struct Trade {
    pub d: i32,
    pub et: u16,
    pub xt: u16,
    pub pnl: f64,
    /// 0 = time exit, 1 = a stop loss fired, 2 = a target fired
    pub r: u8,
    pub legs: Vec<LegOut>,
}

#[derive(Serialize, Debug)]
pub struct LegOut {
    pub strike: i32, // index points
    pub entry: i32,  // paise
    pub exit: i32,   // paise
    pub opt: u8,
    pub side: i8,
    pub lots: u16,
    pub pnl: f64, // rupees for this leg
}

#[derive(Serialize, Debug, Default)]
pub struct Stats {
    pub trades: usize,
    pub days: usize,
    pub total: f64,
    pub avg: f64,
    pub win_rate: f64,
    pub profit_factor: f64,
    pub max_dd: f64,
    pub worst: f64,
    pub best: f64,
    pub skipped_days: usize,
    pub skipped_entries: usize,
    /// entries not taken because a condition did not hold
    pub blocked_entries: usize,
}

#[derive(Serialize, Debug)]
pub struct Day {
    pub d: i32,
    pub pnl: f64,
}

#[derive(Serialize, Debug)]
pub struct BtResult {
    pub trades: Vec<Trade>,
    pub daily: Vec<Day>,
    pub stats: Stats,
}

// ---------------------------------------------------------------- cubes

pub struct CubeYear {
    pub dates: Vec<i32>,
    half: usize,
    ranks: usize,
    c: Mmap,
    c_off: usize,
    expiry: Mmap,
    expiry_off: usize,
    atm: Mmap,
    atm_off: usize,
    spot: Mmap,
    spot_off: usize,
}

fn npy_data_offset(m: &Mmap) -> Result<usize> {
    if m.len() < 12 || &m[..6] != b"\x93NUMPY" {
        return Err(anyhow!("not an npy file"));
    }
    Ok(match m[6] {
        1 => 10 + u16::from_le_bytes([m[8], m[9]]) as usize,
        _ => 12 + u32::from_le_bytes([m[8], m[9], m[10], m[11]]) as usize,
    })
}

fn map(p: &Path) -> Result<(Mmap, usize)> {
    let f = File::open(p).with_context(|| format!("open {}", p.display()))?;
    // SAFETY: the file is only read; the app asks users to close it before rebuilding the store.
    let m = unsafe { Mmap::map(&f)? };
    let off = npy_data_offset(&m)?;
    Ok((m, off))
}

impl CubeYear {
    pub fn open(dir: &Path) -> Result<CubeYear> {
        let meta: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("meta.json"))?)?;
        let dates: Vec<i32> = meta["dates"]
            .as_array()
            .ok_or_else(|| anyhow!("meta dates"))?
            .iter()
            .map(|v| crate::store::parse_date(v.as_str().unwrap_or("")))
            .collect();
        let half = meta["half"].as_u64().unwrap_or(15) as usize;
        let ranks = meta["ranks"].as_u64().unwrap_or(2) as usize;
        let (c, c_off) = map(&dir.join("c.npy"))?;
        let (expiry, expiry_off) = map(&dir.join("expiry.npy"))?;
        let (atm, atm_off) = map(&dir.join("atm.npy"))?;
        let (spot, spot_off) = map(&dir.join("spot_c.npy"))?;
        Ok(CubeYear { dates, half, ranks, c, c_off, expiry, expiry_off, atm, atm_off, spot, spot_off })
    }

    #[inline]
    fn i32_at(m: &Mmap, off: usize, idx: usize) -> i32 {
        let o = off + idx * 4;
        i32::from_le_bytes([m[o], m[o + 1], m[o + 2], m[o + 3]])
    }
    #[inline]
    fn close(&self, d: usize, rank: usize, side: usize, slot: usize, t: usize) -> i32 {
        let s = 2 * self.half + 1;
        Self::i32_at(&self.c, self.c_off, (((d * self.ranks + rank) * 2 + side) * s + slot) * NMIN + t)
    }
    fn spot_at(&self, d: usize, t: usize) -> i32 {
        for k in (0..=t).rev() {
            let v = Self::i32_at(&self.spot, self.spot_off, d * NMIN + k);
            if v > 0 {
                return v;
            }
        }
        0
    }
    /// true when every condition holds at minute t (a missing spot fails the check)
    fn conds_ok(&self, d: usize, t: usize, conds: &[Cond]) -> bool {
        if conds.is_empty() {
            return true;
        }
        let now = self.spot_at(d, t);
        if now <= 0 {
            return false;
        }
        let now = now as f64;
        conds.iter().all(|c| match *c {
            Cond::FromOpen { min, max } => {
                let o = (0..=t).map(|k| Self::i32_at(&self.spot, self.spot_off, d * NMIN + k)).find(|&v| v > 0).unwrap_or(0);
                o > 0 && within((now / o as f64 - 1.0) * 100.0, min, max)
            }
            Cond::LastN { minutes, min, max } => {
                let k = t.saturating_sub(minutes as usize);
                let then = self.spot_at(d, k);
                then > 0 && within((now / then as f64 - 1.0) * 100.0, min, max)
            }
            Cond::DayRange { min, max } => {
                let (mut hi, mut lo) = (0i32, i32::MAX);
                for k in 0..=t {
                    let v = Self::i32_at(&self.spot, self.spot_off, d * NMIN + k);
                    if v > 0 {
                        hi = hi.max(v);
                        lo = lo.min(v);
                    }
                }
                hi > 0 && within((hi - lo) as f64 / now * 100.0, min, max)
            }
        })
    }
    fn atm_open(&self, d: usize) -> i32 {
        Self::i32_at(&self.atm, self.atm_off, d)
    }
    fn expiry_of(&self, d: usize, rank: usize) -> i32 {
        Self::i32_at(&self.expiry, self.expiry_off, d * self.ranks + rank)
    }
}

pub struct Cubes {
    pub years: Vec<CubeYear>,
}

impl Cubes {
    pub fn open_all() -> Cubes {
        let base = store_root().join("cubes");
        let mut years = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&base) {
            let mut dirs: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.join("meta.json").exists()).collect();
            dirs.sort();
            for d in dirs {
                if let Ok(y) = CubeYear::open(&d) {
                    years.push(y);
                }
            }
        }
        Cubes { years }
    }
}

// ---------------------------------------------------------------- engine

fn weekday_idx(d: i32) -> u8 {
    // 0 = Monday. 1970-01-01 was a Thursday (3).
    ((days_from_ymd(d) + 3).rem_euclid(7)) as u8
}

struct Fill {
    slot: usize,
    px: i32,
}

fn pick_slot(y: &CubeYear, d: usize, leg: &LegSpec, t: usize) -> Option<Fill> {
    let side = leg.opt as usize;
    let rank = (leg.rank as usize).min(y.ranks - 1);
    let s = 2 * y.half + 1;
    match leg.pick {
        Pick::Premium { target } => {
            let tp = target * 100.0;
            let mut best: Option<(f64, Fill)> = None;
            for slot in 0..s {
                let mut px = 0;
                for k in (0..=t).rev() {
                    let v = y.close(d, rank, side, slot, k);
                    if v > 0 {
                        px = v;
                        break;
                    }
                }
                if px <= 0 {
                    continue;
                }
                let diff = (px as f64 - tp).abs();
                if best.as_ref().map(|b| diff < b.0).unwrap_or(true) {
                    best = Some((diff, Fill { slot, px }));
                }
            }
            // refuse a strike whose premium is nowhere near the request (sparse days have only far contracts)
            best.filter(|b| b.0 <= (tp * 0.5).max(250.0)).map(|b| b.1)
        }
        Pick::AtmOffset { points } => {
            let spot = y.spot_at(d, t);
            if spot <= 0 {
                return None;
            }
            let atm_now = ((spot as f64 / STEP as f64).round() as i32) * STEP;
            let step_off = ((atm_now - y.atm_open(d)) / STEP) as i64;
            // CE: positive points = OTM = higher strike. PE: positive points = OTM = lower strike.
            let dir = if leg.opt == 0 { 1 } else { -1 };
            let slot = y.half as i64 + step_off + dir * (points as i64 / 50);
            if slot < 0 || slot >= s as i64 {
                return None;
            }
            let slot = slot as usize;
            for k in (0..=t).rev() {
                let v = y.close(d, rank, side, slot, k);
                if v > 0 {
                    return Some(Fill { slot, px: v });
                }
            }
            None
        }
    }
}

pub fn run(cubes: &Cubes, spec: &Spec) -> BtResult {
    let mut trades: Vec<Trade> = Vec::new();
    let mut daily: Vec<Day> = Vec::new();
    let mut skipped_days = 0usize;
    let mut skipped_entries = 0usize;
    let mut blocked_entries = 0usize;
    let exit_t = (spec.exit.time as usize).min(NMIN - 1);

    for y in &cubes.years {
        for (d, &date) in y.dates.iter().enumerate() {
            if let Some(f) = spec.range.from {
                if date < f {
                    continue;
                }
            }
            if let Some(t) = spec.range.to {
                if date > t {
                    continue;
                }
            }
            if spec.limits.weekdays & (1u8 << weekday_idx(date)) == 0 {
                continue;
            }
            let e0 = y.expiry_of(d, 0);
            if e0 == 0 || y.atm_open(d) == 0 {
                skipped_days += 1;
                continue;
            }
            let dte = (days_from_ymd(e0) - days_from_ymd(date)) as i32;
            if spec.limits.dte_min.map(|m| dte < m).unwrap_or(false) || spec.limits.dte_max.map(|m| dte > m).unwrap_or(false) {
                continue;
            }
            let lot = lot_size(date) as f64;
            let mut day_pnl = 0.0;
            let mut day_trades = 0usize;
            let mut entries = 0u16;
            let mut t = spec.schedule.from as usize;
            while t <= spec.schedule.until as usize && t < exit_t && entries < spec.limits.max_entries {
                if !y.conds_ok(d, t, &spec.conditions) {
                    blocked_entries += 1;
                    if spec.schedule.every == 0 {
                        break;
                    }
                    t += spec.schedule.every as usize;
                    continue;
                }
                entries += 1;
                // ---- fills
                let fills: Vec<Option<Fill>> = spec.legs.iter().map(|l| pick_slot(y, d, l, t)).collect();
                if fills.iter().any(|f| f.is_none()) {
                    skipped_entries += 1;
                } else {
                    let fills: Vec<Fill> = fills.into_iter().map(|f| f.unwrap()).collect();
                    // ---- simulate each leg minute by minute
                    let mut legs_out = Vec::new();
                    let mut pnl = 0.0;
                    let mut reason = 0u8;
                    let mut last_xt = t as u16;
                    for (leg, fill) in spec.legs.iter().zip(&fills) {
                        let rank = (leg.rank as usize).min(y.ranks - 1);
                        let entry = fill.px;
                        let mut last = entry;
                        let mut out = entry;
                        let mut xt = exit_t;
                        let mut why = 0u8;
                        for k in (t + 1)..=exit_t {
                            let v = y.close(d, rank, leg.opt as usize, fill.slot, k);
                            if v > 0 {
                                last = v;
                            }
                            let move_pct = leg.side as f64 * (last - entry) as f64 / entry as f64 * 100.0;
                            if let Some(sl) = spec.exit.sl_pct {
                                if move_pct <= -sl {
                                    out = last;
                                    xt = k;
                                    why = 1;
                                    break;
                                }
                            }
                            if let Some(tg) = spec.exit.tgt_pct {
                                if move_pct >= tg {
                                    out = last;
                                    xt = k;
                                    why = 2;
                                    break;
                                }
                            }
                            out = last;
                        }
                        let leg_pnl = leg.side as f64 * (out - entry) as f64 / 100.0 * leg.lots as f64 * lot;
                        pnl += leg_pnl;
                        if why != 0 && reason == 0 {
                            reason = why;
                        }
                        last_xt = last_xt.max(xt as u16);
                        let strike = (y.atm_open(d) + (fill.slot as i32 - y.half as i32) * STEP) / 100;
                        legs_out.push(LegOut { strike, entry, exit: out, opt: leg.opt, side: leg.side, lots: leg.lots, pnl: leg_pnl });
                    }
                    day_pnl += pnl;
                    day_trades += 1;
                    trades.push(Trade { d: date, et: t as u16, xt: last_xt, pnl, r: reason, legs: legs_out });
                }
                if spec.schedule.every == 0 {
                    break;
                }
                t += spec.schedule.every as usize;
            }
            if day_trades > 0 {
                daily.push(Day { d: date, pnl: day_pnl });
            }
        }
    }

    // ---- stats
    let mut st = Stats { trades: trades.len(), days: daily.len(), skipped_days, skipped_entries, blocked_entries, ..Default::default() };
    let (mut gain, mut loss, mut wins) = (0.0, 0.0, 0usize);
    let (mut cum, mut peak, mut dd) = (0.0f64, 0.0f64, 0.0f64);
    st.worst = f64::MAX;
    st.best = f64::MIN;
    for tr in &trades {
        st.total += tr.pnl;
        if tr.pnl > 0.0 {
            gain += tr.pnl;
            wins += 1;
        } else {
            loss += -tr.pnl;
        }
        st.worst = st.worst.min(tr.pnl);
        st.best = st.best.max(tr.pnl);
        cum += tr.pnl;
        peak = peak.max(cum);
        dd = dd.max(peak - cum);
    }
    if trades.is_empty() {
        st.worst = 0.0;
        st.best = 0.0;
    } else {
        st.avg = st.total / trades.len() as f64;
        st.win_rate = wins as f64 / trades.len() as f64 * 100.0;
        st.profit_factor = if loss > 0.0 { gain / loss } else { f64::INFINITY };
    }
    st.max_dd = dd;
    BtResult { trades, daily, stats: st }
}

// ---------------------------------------------------------------- variations (grid)

#[derive(Deserialize, Clone, Debug)]
pub struct Axis {
    /// first | every | premium | offset | exit | sl | target
    pub param: String,
    pub values: Vec<f64>,
}

#[derive(Serialize, Debug)]
pub struct Cell {
    pub x: usize,
    pub y: usize,
    pub trades: usize,
    pub total: f64,
    pub win_rate: f64,
    pub avg: f64,
    pub max_dd: f64,
    pub profit_factor: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct GridResult {
    pub cells: Vec<Cell>,
    pub applied_legs: usize,
}

/// Apply one variation to a spec. Returns how many legs/fields it changed.
fn apply(spec: &mut Spec, param: &str, v: f64) -> usize {
    match param {
        "first" => {
            spec.schedule.from = v as u16;
            if spec.schedule.every == 0 || spec.schedule.until < spec.schedule.from {
                spec.schedule.until = spec.schedule.from;
            }
            1
        }
        "every" => {
            spec.schedule.every = v as u16;
            1
        }
        "exit" => {
            spec.exit.time = v as u16;
            1
        }
        "sl" => {
            spec.exit.sl_pct = if v > 0.0 { Some(v) } else { None };
            1
        }
        "target" => {
            spec.exit.tgt_pct = if v > 0.0 { Some(v) } else { None };
            1
        }
        "premium" => {
            let mut n = 0;
            for l in spec.legs.iter_mut() {
                if let Pick::Premium { target } = &mut l.pick {
                    *target = v;
                    n += 1;
                }
            }
            n
        }
        "offset" => {
            let mut n = 0;
            for l in spec.legs.iter_mut() {
                if let Pick::AtmOffset { points } = &mut l.pick {
                    *points = v as i32;
                    n += 1;
                }
            }
            n
        }
        _ => 0,
    }
}

/// Run every combination of up to two axes, in parallel across cells.
pub fn grid(cubes: &Cubes, base: &Spec, xa: &Axis, ya: &Axis) -> Result<GridResult> {
    let mut applied = usize::MAX;
    let mut jobs: Vec<(usize, usize, Spec)> = Vec::new();
    for (yi, yv) in ya.values.iter().enumerate() {
        for (xi, xv) in xa.values.iter().enumerate() {
            let mut s = base.clone();
            let a = apply(&mut s, &xa.param, *xv).min(apply(&mut s, &ya.param, *yv));
            applied = applied.min(a);
            jobs.push((xi, yi, s));
        }
    }
    if applied == 0 {
        return Err(anyhow!("One of the axes does not apply to this strategy (for example premium needs a leg that picks by premium)."));
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let out = std::sync::Mutex::new(Vec::<Cell>::with_capacity(jobs.len()));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(1).max(1);
    std::thread::scope(|sc| {
        for _ in 0..threads {
            sc.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if i >= jobs.len() {
                    break;
                }
                let (x, y, spec) = &jobs[i];
                let r = run(cubes, spec);
                let s = r.stats;
                let cell = Cell {
                    x: *x,
                    y: *y,
                    trades: s.trades,
                    total: s.total,
                    win_rate: s.win_rate,
                    avg: s.avg,
                    max_dd: s.max_dd,
                    profit_factor: if s.profit_factor.is_finite() { Some(s.profit_factor) } else { None },
                };
                out.lock().unwrap().push(cell);
            });
        }
    });
    let mut cells = out.into_inner().unwrap();
    cells.sort_by_key(|c| (c.y, c.x));
    Ok(GridResult { cells, applied_legs: if applied == usize::MAX { 0 } else { applied } })
}