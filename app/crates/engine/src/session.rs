use crate::config::lot_size;
use crate::daybook::DayBook;
use crate::legs::{Leg, LegPatch};
use crate::store::Store;
use crate::NMIN;
use anyhow::{anyhow, Result};
use std::sync::Arc;

/// Last tradable minute shown by default (15:30).
pub const T_MAX: usize = 375;

#[derive(Clone, Debug)]
pub struct View {
    pub rank: u8,
    pub x_min: f32, // rupees; 0 = auto
    pub x_max: f32,
    pub width_px: u16,
    pub t_plus: u16, // minutes forward for the T+n curve
    pub half_rows: u16,
}

pub struct Session {
    pub book: Option<Arc<DayBook>>,
    pub date: i32,
    pub t: usize,
    pub legs: Vec<Leg>,
    pub next_id: u32,
    pub view: View,
    pub lot: u16,
}

impl Session {
    pub fn new() -> Self {
        Session {
            book: None,
            date: 0,
            t: 0,
            legs: vec![],
            next_id: 1,
            view: View { rank: 0, x_min: 0.0, x_max: 0.0, width_px: 600, t_plus: 0, half_rows: 40 },
            lot: 75,
        }
    }

    pub fn open_day(&mut self, store: &Store, date: i32, keep_t: bool) -> Result<()> {
        let book = Arc::new(DayBook::load(store, date)?);
        self.book = Some(book);
        self.date = date;
        self.lot = lot_size(date);
        self.legs.clear(); // intraday only for M1-M3: open positions never carry across days
        if !keep_t {
            self.t = 0;
        }
        self.view.x_min = 0.0;
        self.view.x_max = 0.0;
        Ok(())
    }

    pub fn set_clock(&mut self, t: i32) {
        self.t = t.clamp(0, T_MAX as i32) as usize;
    }

    pub fn step(&mut self, delta: i32) {
        self.set_clock(self.t as i32 + delta);
    }

    fn book(&self) -> Result<&Arc<DayBook>> {
        self.book.as_ref().ok_or_else(|| anyhow!("no day open"))
    }

    pub fn leg_add(&mut self, side: i8, opt: u8, rank: u8, strike: i32, lots: u16) -> Result<u32> {
        let book = self.book()?.clone();
        let ser = book.series(rank, strike, opt).ok_or_else(|| anyhow!("no such contract"))?;
        let px = ser.c[self.t];
        if px <= 0 {
            return Err(anyhow!("no print at or before this minute"));
        }
        let id = self.next_id;
        self.next_id += 1;
        self.legs.push(Leg {
            id,
            side,
            opt,
            rank,
            strike,
            offset: strike - book.atm(self.t),
            lots: lots.max(1),
            entry_t: self.t as u16,
            exit_t: None,
            entry_px: px,
            manual: false,
        });
        Ok(id)
    }

    pub fn leg_update(&mut self, id: u32, p: LegPatch) -> Result<()> {
        let book = self.book()?.clone();
        let leg = self.legs.iter_mut().find(|l| l.id == id).ok_or_else(|| anyhow!("no such leg"))?;
        if let Some(l) = p.lots {
            leg.lots = l.max(1);
        }
        if let Some(s) = p.side {
            leg.side = if s >= 0 { 1 } else { -1 };
        }
        if let Some(e) = p.exit_t {
            leg.exit_t = e.map(|v| v.min((NMIN - 1) as u16));
        }
        if let Some(et) = p.entry_t {
            leg.entry_t = et.min((NMIN - 1) as u16);
            if let Some(ser) = book.series(leg.rank, leg.strike, leg.opt) {
                let px = ser.c[leg.entry_t as usize];
                if px > 0 {
                    leg.entry_px = px;
                    leg.manual = false;
                }
            }
        }
        if let Some(px) = p.entry_px {
            leg.entry_px = px;
            leg.manual = true;
        }
        Ok(())
    }

    pub fn leg_remove(&mut self, id: u32) {
        self.legs.retain(|l| l.id != id);
    }
}
