"""Build memory-mapped numpy cubes from the research store.

  python build_cubes.py [--asset NIFTY] [--half 15] [--ranks 2] [--year 2026]

Per year -> D:\\Dataset_bt\\asset=<A>\\cubes\\year=<Y>\\{o,h,l,c,volume,oi}.npy  shape [day, rank, side, slot, minute]
  slot 'half' is the ATM strike at the day's open (spot close at 09:15 rounded to 50 points); slots are fixed for the day.
  minute 0 = 09:15 ... 384 = 15:39.  0 = no data.
Also: expiry.npy [day, rank] (yyyymmdd), atm.npy [day] (strike paise), spot_c.npy [day, minute], meta.json.
Written to a temp dir then swapped in atomically.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time

import numpy as np
import polars as pl

sys.path.insert(0, os.path.dirname(__file__))
from store import ROOT, M0, NMIN, Store  # noqa: E402

STEP = 5000          # 50 index points in paise


def build_year(st: Store, year: int, half: int, ranks: int) -> None:
    dates = [d for d in st.trading_days() if d.startswith(str(year))]
    if not dates:
        return
    nd, ns = len(dates), 2 * half + 1
    shape = (nd, ranks, 2, ns, NMIN)
    out = st.root / "cubes" / f"year={year}"
    tmp = st.root / "cubes" / f"_tmp_year={year}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    arr = {f: np.lib.format.open_memmap(tmp / f"{f}.npy", mode="w+", dtype=np.int32, shape=shape)
           for f in ("o", "h", "l", "c", "volume", "oi")}
    expiry = np.zeros((nd, ranks), np.int32)
    atm = np.zeros(nd, np.int32)
    spot = np.zeros((nd, NMIN), np.int32)
    dim = st.dim.filter(pl.col("kind") == "OPT").select(
        "symbol_id", "expiry", "strike", pl.col("opt_type").eq("PE").cast(pl.Int8).alias("side"))
    t0 = time.time()
    for i, d in enumerate(dates):
        sp = st.spot_day(d).filter((pl.col("m") >= M0) & (pl.col("m") < M0 + NMIN))
        mi = sp["m"].to_numpy() - M0
        spot[i, mi] = sp["c"].to_numpy()
        open_px = sp.filter(pl.col("m") >= M0).sort("m")["c"][0] if sp.height else None
        if open_px is None:
            continue
        a = int(round(open_px / STEP)) * STEP
        atm[i] = a
        dd = np.datetime64(d)
        b = st._bars(d).join(dim, on="symbol_id").filter(
            (pl.col("expiry") >= dd) & (pl.col("m") >= M0) & (pl.col("m") < M0 + NMIN)
            & ((pl.col("strike") - a).abs() <= half * STEP))
        if b.is_empty():
            continue
        exps = sorted(b["expiry"].unique().to_list())[:ranks]
        for r, e in enumerate(exps):
            expiry[i, r] = int(e.strftime("%Y%m%d"))
        rank = b["expiry"].replace_strict(exps, list(range(len(exps))), default=-1).to_numpy()
        keep = rank >= 0
        slot = ((b["strike"].to_numpy() - a) // STEP + half)
        m = b["m"].to_numpy() - M0
        side = b["side"].to_numpy()
        idx = (rank[keep], side[keep], slot[keep], m[keep])
        for f in arr:
            arr[f][i][idx] = b[f].to_numpy()[keep]
        if (i + 1) % 50 == 0:
            print(f"  {year}: {i+1}/{nd} days {time.time()-t0:.0f}s", flush=True)
    for mm in arr.values():
        mm.flush()
    del arr, mm, b        # release memmap handles (Windows cannot rename an open mapped dir)
    import gc
    gc.collect()
    np.save(tmp / "expiry.npy", expiry)
    np.save(tmp / "atm.npy", atm)
    np.save(tmp / "spot_c.npy", spot)
    (tmp / "meta.json").write_text(json.dumps(
        {"dates": dates, "half": half, "step": STEP, "ranks": ranks, "minute0": M0, "nmin": NMIN,
         "shape": list(shape), "built_at": time.strftime("%Y-%m-%dT%H:%M:%S")}))
    if out.exists():
        shutil.rmtree(out)
    os.replace(tmp, out)
    print(f"year {year}: {nd} days -> {out} in {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", default="NIFTY")
    ap.add_argument("--half", type=int, default=15)
    ap.add_argument("--ranks", type=int, default=2)
    ap.add_argument("--year", type=int)
    a = ap.parse_args()
    st = Store(a.asset)
    years = [a.year] if a.year else sorted({int(d[:4]) for d in st.trading_days() if d >= "2024-01-01"})
    for y in years:
        build_year(st, y, a.half, a.ranks)
