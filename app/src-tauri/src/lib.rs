use engine::backtest::{self, Axis, Cubes, Spec};
use engine::config::store_root;
use engine::frame;
use engine::legs::LegPatch;
use engine::session::Session;
use engine::store::{weekday, Store};
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::State;

struct App {
    cubes: Cubes,
    store: Store,
    sess: Mutex<Session>,
}

type Res = Result<Response, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn frame_of(app: &App, s: &Session) -> Response {
    Response::new(frame::build(s, &app.store))
}

/// Run a rule-based backtest. The spec is plain data; nothing in it is executed as code.
#[tauri::command]
fn bt_run(app: State<App>, spec: serde_json::Value) -> Result<serde_json::Value, String> {
    let spec: Spec = serde_json::from_value(spec).map_err(|e| format!("Invalid strategy: {e}"))?;
    if spec.legs.is_empty() {
        return Err("Add at least one leg.".into());
    }
    let t0 = std::time::Instant::now();
    let res = backtest::run(&app.cubes, &spec);
    let mut v = serde_json::to_value(&res).map_err(err)?;
    v["ms"] = serde_json::json!(t0.elapsed().as_millis() as u64);
    Ok(v)
}

/// Run a grid of variations (up to two axes) of one strategy.
#[tauri::command]
fn bt_grid(app: State<App>, spec: serde_json::Value, x: Axis, y: Axis) -> Result<serde_json::Value, String> {
    let spec: Spec = serde_json::from_value(spec).map_err(|e| format!("Invalid strategy: {e}"))?;
    if spec.legs.is_empty() {
        return Err("Add at least one leg.".into());
    }
    if x.values.is_empty() || y.values.is_empty() || x.values.len() * y.values.len() > 400 {
        return Err("Each axis needs at least one value, and the grid is limited to 400 cells.".into());
    }
    let t0 = std::time::Instant::now();
    let g = backtest::grid(&app.cubes, &spec, &x, &y).map_err(err)?;
    let mut v = serde_json::to_value(&g).map_err(err)?;
    v["ms"] = serde_json::json!(t0.elapsed().as_millis() as u64);
    Ok(v)
}

#[tauri::command]
fn store_info(app: State<App>) -> serde_json::Value {
    let days: Vec<serde_json::Value> = app
        .store
        .days
        .iter()
        .map(|d| serde_json::json!({ "d": d.date, "n": d.n_symbols, "wd": weekday(d.date) }))
        .collect();
    serde_json::json!({ "days": days, "root": app.store.root.to_string_lossy() })
}

#[tauri::command]
fn open_day(app: State<App>, date: i32, keep_t: Option<bool>) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.open_day(&app.store, date, keep_t.unwrap_or(false)).map_err(err)?;
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn day_spot(app: State<App>) -> Res {
    let s = app.sess.lock().map_err(err)?;
    let book = s.book.as_ref().ok_or("no day open")?;
    Ok(Response::new(frame::spot_bytes(book)))
}

#[tauri::command]
fn set_clock(app: State<App>, t: i32) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.set_clock(t);
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn step(app: State<App>, delta: i32) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.step(delta);
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn set_view(
    app: State<App>,
    rank: Option<u8>,
    width_px: Option<u16>,
    x_min: Option<f32>,
    x_max: Option<f32>,
    t_plus: Option<u16>,
    half_rows: Option<u16>,
) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    if let Some(v) = rank {
        s.view.rank = v.min(1);
    }
    if let Some(v) = width_px {
        s.view.width_px = v;
    }
    if let Some(v) = x_min {
        s.view.x_min = v;
    }
    if let Some(v) = x_max {
        s.view.x_max = v;
    }
    if let Some(v) = t_plus {
        s.view.t_plus = v;
    }
    if let Some(v) = half_rows {
        s.view.half_rows = v.clamp(5, 200);
    }
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn leg_add(app: State<App>, side: i8, opt: u8, rank: u8, strike: i32, lots: u16) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.leg_add(side, opt, rank, strike, lots).map_err(err)?;
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn leg_update(
    app: State<App>,
    id: u32,
    lots: Option<u16>,
    side: Option<i8>,
    exit_t: Option<i32>, // -1 clears the exit
    entry_t: Option<u16>,
) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    let patch = LegPatch {
        lots,
        side,
        exit_t: exit_t.map(|v| if v < 0 { None } else { Some(v as u16) }),
        entry_t,
        entry_px: None,
    };
    s.leg_update(id, patch).map_err(err)?;
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn leg_remove(app: State<App>, id: u32) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.leg_remove(id);
    Ok(frame_of(&app, &s))
}

#[tauri::command]
fn legs_clear(app: State<App>) -> Res {
    let mut s = app.sess.lock().map_err(err)?;
    s.legs.clear();
    Ok(frame_of(&app, &s))
}

pub fn run() {
    let store = Store::open(&store_root()).unwrap_or_else(|e| {
        eprintln!("cannot open store {}: {e:#}", store_root().display());
        std::process::exit(2);
    });
    tauri::Builder::default()
        .manage(App { cubes: Cubes::open_all(), store, sess: Mutex::new(Session::new()) })
        .invoke_handler(tauri::generate_handler![
            store_info, bt_run, bt_grid, open_day, day_spot, set_clock, step, set_view, leg_add, leg_update, leg_remove, legs_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running OPTLAB");
}
