# Dataset_bt - NIFTY 1m research store (Fyers + Nubra)

Source: E:\Dataset\full_1m (merged, untouched). Code: D:\Dataset_bt\code.

| Layer | Path | Use |
|---|---|---|
| dim | asset=NIFTY\dim_symbol.parquet | symbol_id (append-only) -> expiry/strike/type |
| bars | asset=NIFTY\bars\trade_date=*\part0.parquet | all contracts, 1 file/day, sorted (symbol_id, m) |
| spot | asset=NIFTY\spot\... | index 1m |
| cubes | asset=NIFTY\cubes\year=Y\*.npy | [day, rank, side, slot, minute] mmap arrays, ATM+/-15, 2 nearest expiries |
| meta | manifest.json, day_index.parquet | sha256 per file, row counts, validation result |

Units: prices int32 paise; m = minute of day (555 = 09:15); cube minute 0 = 09:15 .. 384 = 15:39; 0 = no data.

Commands (python 3.12):
- `python code\build_store.py [--from 2026-11-01]`   incremental by date range, validates, exits 1 on mismatch
- `python code\build_cubes.py --year 2026`            rebuild one year's cubes
- `python code\bench.py`                              reference straddle benchmark

Python: `from store import Store; s=Store(); c=s.cube(2026); c.c[day,0,0,15,:]` = nearest-expiry ATM CE close.

## OPTLAB desktop app (app/)

Tauri v2 + Rust engine + SolidJS. Three tabs: Simulator (option chain, legs, payoff, replay), Backtesting
(step builder or a Python-style script that is parsed, never executed) and Results (tearsheet, variations
heatmap, side-by-side compare).

The data store (asset=NIFTY, about 2 GB) is NOT in this repository. Get it separately and point the app at it:

- Windows: `setx OPTLAB_STORE "F:\path\to\asset=NIFTY"` then restart the terminal.
- Default if unset: `D:\Dataset_bt\asset=NIFTY`.

Build and run (needs Rust, Node 22, Visual Studio C++ build tools; WebView2 ships with Windows 10/11):

- `cd app && npm install`
- `npm run tauri dev` for development, `npm run tauri build` for an installer.

The Python builders in `code/` have the original D: and E: paths written in; edit them for another machine if you
rebuild the store from raw data. Lot sizes in `app/crates/engine/src/config.rs` are unverified against NSE circulars.
