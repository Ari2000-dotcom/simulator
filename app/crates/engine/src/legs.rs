#[derive(Clone, Debug)]
pub struct Leg {
    pub id: u32,
    pub side: i8, // +1 buy, -1 sell
    pub opt: u8,  // 0 CE, 1 PE
    pub rank: u8,
    pub strike: i32,   // paise, locked at entry
    pub offset: i32,   // paise relative to ATM at entry (display only)
    pub lots: u16,
    pub entry_t: u16,
    pub exit_t: Option<u16>,
    pub entry_px: i32, // paise
    pub manual: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending = 0,
    Open = 1,
    Exited = 2,
    NoData = 3,
}

#[derive(Default, Clone, Debug)]
pub struct LegPatch {
    pub lots: Option<u16>,
    pub side: Option<i8>,
    pub exit_t: Option<Option<u16>>,
    pub entry_t: Option<u16>,
    pub entry_px: Option<i32>,
}
