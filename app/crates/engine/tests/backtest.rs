use engine::backtest::{run, Cubes, Spec};
use engine::config::lot_size;

fn spec(json: &str) -> Spec {
    serde_json::from_str(json).unwrap()
}

#[test]
fn straddle_matches_python_oracle() {
    let cubes = Cubes::open_all();
    assert!(!cubes.years.is_empty(), "cubes missing");
    let s = spec(r#"{"schedule":{"from":5,"every":0,"until":5},
        "legs":[{"side":-1,"opt":0,"pick":{"by":"atm_offset","points":0}},{"side":-1,"opt":1,"pick":{"by":"atm_offset","points":0}}],
        "exit":{"time":360}, "range":{"from":20240101}}"#);
    let t = std::time::Instant::now();
    let r = run(&cubes, &s);
    println!("ran in {:?}: {} trades, {} skipped entries, {} skipped days", t.elapsed(), r.stats.trades, r.stats.skipped_entries, r.stats.skipped_days);
    let points: f64 = r.trades.iter().map(|t| t.pnl / lot_size(t.d) as f64).sum();
    println!("total points {points:.1} (python oracle 3082.4 over 575 trades)");
    assert!((r.stats.trades as i64 - 575).abs() <= 25);
    assert!((points - 3082.4).abs() < 400.0);
}

#[test]
fn hourly_premium_strangle_runs() {
    let cubes = Cubes::open_all();
    let s = spec(r#"{"schedule":{"from":5,"every":60,"until":300},
        "legs":[{"side":-1,"opt":0,"pick":{"by":"premium","target":20}},{"side":-1,"opt":1,"pick":{"by":"premium","target":20}}],
        "exit":{"time":360,"sl_pct":100}, "range":{"from":20241001}}"#);
    let t = std::time::Instant::now();
    let r = run(&cubes, &s);
    println!("ran in {:?}: {} trades over {} days, total {:.0}, win {:.1}%, maxdd {:.0}", t.elapsed(), r.stats.trades, r.stats.days, r.stats.total, r.stats.win_rate, r.stats.max_dd);
    assert!(r.stats.trades > 500);
}

#[test]
fn grid_runs_in_parallel() {
    use engine::backtest::{grid, Axis};
    let cubes = Cubes::open_all();
    let s = spec(r#"{"schedule":{"from":5,"every":0,"until":5},
        "legs":[{"side":-1,"opt":0,"pick":{"by":"premium","target":20}},{"side":-1,"opt":1,"pick":{"by":"premium","target":20}}],
        "exit":{"time":360}, "range":{"from":20241001}}"#);
    let xa = Axis { param: "premium".into(), values: vec![10.0, 15.0, 20.0, 25.0, 30.0] };
    let ya = Axis { param: "first".into(), values: vec![5.0, 65.0, 125.0, 185.0, 245.0, 305.0] };
    let t = std::time::Instant::now();
    let g = grid(&cubes, &s, &xa, &ya).unwrap();
    println!("grid {} cells in {:?}", g.cells.len(), t.elapsed());
    assert_eq!(g.cells.len(), 30);
    assert!(g.cells.iter().any(|c| c.trades > 100));
    // a premium axis on a strategy with no premium legs must be refused, not silently ignored
    let atm = spec(r#"{"schedule":{"from":5,"every":0,"until":5},"legs":[{"side":-1,"opt":0,"pick":{"by":"atm_offset","points":0}}],"exit":{"time":360}}"#);
    assert!(grid(&cubes, &atm, &xa, &ya).is_err());
}

#[test]
fn conditions_filter_entries() {
    let cubes = Cubes::open_all();
    let base = r#"{"schedule":{"from":60,"every":0,"until":60},
        "legs":[{"side":-1,"opt":0,"pick":{"by":"atm_offset","points":0}},{"side":-1,"opt":1,"pick":{"by":"atm_offset","points":0}}],
        "exit":{"time":360}, "range":{"from":20241001}"#;
    let all = run(&cubes, &spec(&format!("{base}}}")));
    let up = run(&cubes, &spec(&format!(r#"{base},"conditions":[{{"kind":"from_open","min":0.0}}]}}"#)));
    let down = run(&cubes, &spec(&format!(r#"{base},"conditions":[{{"kind":"from_open","max":0.0}}]}}"#)));
    println!("all {} up {} down {} blocked {}", all.stats.trades, up.stats.trades, down.stats.trades, up.stats.blocked_entries);
    assert!(up.stats.trades > 0 && down.stats.trades > 0);
    assert!(up.stats.trades < all.stats.trades && down.stats.trades < all.stats.trades);
    // up and down overlap only at exactly 0.0, so together they cover every day
    assert!(up.stats.trades + down.stats.trades >= all.stats.trades);
    assert_eq!(up.stats.blocked_entries, all.stats.trades - up.stats.trades + (all.stats.skipped_entries - up.stats.skipped_entries.min(all.stats.skipped_entries)));
}
