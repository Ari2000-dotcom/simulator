use engine::config::store_root;
use engine::frame::{build, HEADER, LEG, ROW, STATS};
use engine::session::Session;
use engine::store::Store;
use std::time::Instant;

#[test]
fn load_day_and_build_frame() {
    let store = Store::open(&store_root()).unwrap();
    assert!(store.days.len() > 1000);
    let mut s = Session::new();
    let t0 = Instant::now();
    s.open_day(&store, 20261015, false).unwrap();
    println!("open_day {:?}", t0.elapsed());
    let book = s.book.clone().unwrap();
    println!("expiries {:?} strikes0 {} syms {}", book.expiries, book.strikes[0].len(), book.n_symbols);
    s.set_clock(5); // 09:20
    let atm = book.atm(5);
    let ce = s.leg_add(-1, 0, 0, atm, 1).unwrap();
    let pe = s.leg_add(-1, 1, 0, atm, 1).unwrap();
    assert!(ce != pe);
    s.set_clock(360); // 15:15
    let t1 = Instant::now();
    let f = build(&s, &store);
    println!("frame {} bytes in {:?}", f.len(), t1.elapsed());
    let n_rows = u16::from_le_bytes([f[38], f[39]]) as usize;
    let n_legs = u16::from_le_bytes([f[40], f[41]]) as usize;
    let n_curve = u16::from_le_bytes([f[42], f[43]]) as usize;
    assert_eq!(n_legs, 2);
    assert_eq!(f.len(), HEADER + n_rows * ROW + n_legs * LEG + n_curve * 8 + STATS);
    // pnl of a short straddle 09:20 -> 15:15 in rupees
    let st = f.len() - STATS;
    let pnl_now = f64::from_le_bytes(f[st + 40..st + 48].try_into().unwrap());
    let net = f64::from_le_bytes(f[st..st + 8].try_into().unwrap());
    println!("net premium {net:.0} pnl_now {pnl_now:.0} rows {n_rows}");
    assert!(net > 0.0, "short straddle must be a credit");
    assert!(pnl_now.abs() < 100000.0);
}
