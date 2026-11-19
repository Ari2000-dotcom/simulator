use std::path::PathBuf;

/// Store root: env OPTLAB_STORE overrides the default.
pub fn store_root() -> PathBuf {
    std::env::var("OPTLAB_STORE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"D:\Dataset_bt\asset=NIFTY"))
}

/// Dated NIFTY lot sizes (effective from date inclusive). UNVERIFIED: confirm against NSE circulars.
const LOTS: &[(i32, u16)] = &[(20000101, 50), (20240426, 25), (20241120, 75), (20251230, 65)];

pub fn lot_size(date: i32) -> u16 {
    let mut l = LOTS[0].1;
    for (d, s) in LOTS {
        if date >= *d {
            l = *s;
        }
    }
    l
}
