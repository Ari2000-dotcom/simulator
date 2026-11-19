"""Build the research store (layer 1) from E:\\Dataset\\full_1m  ->  D:\\Dataset_bt\\asset=<A>\\

  python build_store.py [--asset NIFTY] [--from 2024-01-01] [--to 2026-12-31] [--rebuild]

Layout written
  dim_symbol.parquet                      symbol_id (stable, append-only), symbol, kind, expiry, strike, opt_type
  bars/trade_date=YYYY-MM-DD/part.parquet symbol_id,m,o,h,l,c,volume,oi,iv_bp,src  (sorted by symbol_id,m)
  spot/trade_date=YYYY-MM-DD/part.parquet m,o,h,l,c,src
  day_index.parquet                       per-day stats
  manifest.json                           schema version, per-partition rows + sha256, source totals

Rules
  * m = minute of day in IST (09:15 = 555). prices are int32 paise (same unit as source).
  * Every date partition is built in a staging dir and swapped in with os.replace -> never half-written.
  * symbol_id is append-only: re-running or appending a new day never renumbers old ids.
  * Build fails (exit 1) if row parity / duplicate checks fail.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

SCHEMA_VERSION = 1
SRC_ROOT = Path(r"E:/Dataset/full_1m")
OUT_ROOT = Path(r"D:/Dataset_bt")
TMP = OUT_ROOT / "_tmp"
LOGS = OUT_ROOT / "_logs"


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    with open(LOGS / f"build_{time.strftime('%Y%m%d')}.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def connect() -> duckdb.DuckDBPyConnection:
    TMP.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.sql("set TimeZone='Asia/Kolkata'")
    con.sql(f"set temp_directory='{TMP.as_posix()}'")
    con.sql("set memory_limit='9GB'")
    con.sql("set max_temp_directory_size='40GB'")
    con.sql("set preserve_insertion_order=false")
    return con


def update_dim(con, src_glob: str, dim_path: Path) -> int:
    """Append-only symbol dictionary. Returns number of symbols."""
    new = con.sql(f"""
        select distinct symbol, kind, expiry, strike, opt_type
        from read_parquet('{src_glob}')""").df()
    if dim_path.exists():
        old = pd.read_parquet(dim_path)
        merged = new.merge(old[["symbol"]], on="symbol", how="left", indicator=True)
        add = new[merged["_merge"].to_numpy() == "left_only"]
        nxt = int(old["symbol_id"].max()) + 1
    else:
        old, add, nxt = None, new, 0
    add = add.sort_values(["expiry", "kind", "strike", "opt_type", "symbol"]).reset_index(drop=True)
    add.insert(0, "symbol_id", range(nxt, nxt + len(add)))
    dim = add if old is None else pd.concat([old, add], ignore_index=True)
    dim["symbol_id"] = dim["symbol_id"].astype("int32")
    dim["strike"] = dim["strike"].astype("int32")
    tmp = dim_path.with_suffix(".tmp")
    dim.to_parquet(tmp, index=False, compression="zstd")
    os.replace(tmp, dim_path)
    log(f"dim_symbol: {len(dim)} symbols ({len(add)} new)")
    return len(dim)


def month_ranges(d0: str, d1: str):
    s = pd.Timestamp(d0).normalize()
    e = pd.Timestamp(d1).normalize()
    cur = s.replace(day=1)
    while cur <= e:
        nxt = (cur + pd.offsets.MonthBegin(1))
        yield max(cur, s), min(nxt - pd.Timedelta(days=1), e)
        cur = nxt


def swap_partitions(stage: Path, final: Path) -> int:
    n = 0
    for d in sorted(stage.iterdir()):
        if not d.is_dir():
            continue
        dest = final / d.name
        final.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest)
        os.replace(d, dest)
        n += 1
    return n


def build(asset: str, d0: str, d1: str) -> None:
    src_opt = (SRC_ROOT / f"asset={asset}" / "year=*" / "*.parquet").as_posix()
    src_spot = (SRC_ROOT / f"asset={asset}" / "spot" / "*.parquet").as_posix()
    root = OUT_ROOT / f"asset={asset}"
    root.mkdir(parents=True, exist_ok=True)
    con = connect()
    dim_path = root / "dim_symbol.parquet"
    update_dim(con, src_opt, dim_path)
    con.sql(f"create view dim as select * from read_parquet('{dim_path.as_posix()}')")
    con.sql(f"""create view src as
        select s.*, cast(s.ts as date) as trade_date, hour(s.ts)*60+minute(s.ts) as m
        from read_parquet('{src_opt}') s""")
    con.sql(f"""create view sp as
        select *, cast(ts as date) as trade_date, hour(ts)*60+minute(ts) as m
        from read_parquet('{src_spot}')""")

    for a, b in month_ranges(d0, d1):
        a_s, b_s = a.strftime("%Y-%m-%d"), b.strftime("%Y-%m-%d")
        stage = TMP / f"stage_{asset}_{a_s}"
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(parents=True)
        t0 = time.time()
        con.sql(f"""copy (
            select cast(src.trade_date as varchar) as trade_date, d.symbol_id,
                   cast(src.m as smallint) as m,
                   cast(src.open as int) as o, cast(src.high as int) as h,
                   cast(src.low as int) as l, cast(src.close as int) as c,
                   cast(src.volume as int) as volume, cast(src.oi as int) as oi,
                   cast(src.iv_bp as float) as iv_bp,
                   cast(case src.src when 'fyers' then 0 else 1 end as utinyint) as src
            from src join dim d using (symbol)
            where src.trade_date between date '{a_s}' and date '{b_s}'
            order by src.trade_date, d.symbol_id, src.m
        ) to '{(stage / "bars").as_posix()}' (format parquet, compression zstd,
            partition_by (trade_date), filename_pattern 'part', overwrite_or_ignore, row_group_size 500000)""")
        con.sql(f"""copy (
            select cast(trade_date as varchar) as trade_date, cast(m as smallint) as m,
                   open as o, high as h, low as l, close as c,
                   cast(case src when 'fyers' then 0 else 1 end as utinyint) as src
            from sp where trade_date between date '{a_s}' and date '{b_s}'
            order by trade_date, m
        ) to '{(stage / "spot").as_posix()}' (format parquet, compression zstd,
            partition_by (trade_date), filename_pattern 'part', overwrite_or_ignore)""")
        nb = swap_partitions(stage / "bars", root / "bars") if (stage / "bars").exists() else 0
        ns = swap_partitions(stage / "spot", root / "spot") if (stage / "spot").exists() else 0
        shutil.rmtree(stage, ignore_errors=True)
        log(f"{a_s}..{b_s}: bars days={nb} spot days={ns} in {time.time()-t0:.1f}s")

    finalize(con, asset, root, d0, d1, src_opt, src_spot)


def finalize(con, asset, root: Path, d0, d1, src_opt, src_spot) -> None:
    """Day index + manifest + validation. Exits 1 on any mismatch."""
    bars_glob = (root / "bars" / "trade_date=*" / "part*.parquet").as_posix()
    di = con.sql(f"""
        select cast(trade_date as date) as trade_date, count(*) as n_rows,
               count(distinct symbol_id) as n_symbols, min(m) as m_min, max(m) as m_max,
               sum(case when src=1 then 1 else 0 end) as n_nubra
        from read_parquet('{bars_glob}', hive_partitioning=true) group by 1 order by 1""").df()
    di.to_parquet(root / "day_index.parquet", index=False, compression="zstd")

    # --- validation ---
    errs = []
    # 1. row parity per day vs source for the requested range
    s = con.sql(f"select trade_date, count(*) as n from src where trade_date between date '{d0}' and date '{d1}' group by 1").df()
    s["trade_date"] = pd.to_datetime(s["trade_date"])
    chk = di.assign(trade_date=pd.to_datetime(di["trade_date"])).merge(s, on="trade_date", how="outer").fillna(-1)
    chk = chk[(chk["trade_date"] >= pd.Timestamp(d0)) & (chk["trade_date"] <= pd.Timestamp(d1))]
    bad = chk[chk["n_rows"] != chk["n"]]
    if len(bad):
        errs.append(f"row parity mismatch on {len(bad)} days, e.g. {bad.head(3).to_dict('records')}")
    # 2. duplicates on (date, symbol_id, m)
    dup = con.sql(f"""select count(*) from (select trade_date, symbol_id, m from
        read_parquet('{bars_glob}', hive_partitioning=true)
        where trade_date between '{d0}' and '{d1}' group by all having count(*)>1)""").fetchone()[0]
    if dup:
        errs.append(f"{dup} duplicate (date,symbol_id,m) keys")
    # 3. value spot check: 20k random source rows must match exactly
    ck = con.sql(f"""
        with s as (select src.trade_date, d.symbol_id, src.m, src.open, src.high, src.low, src.close,
                          src.volume, src.oi from src join dim d using (symbol)
                    where src.trade_date between date '{d0}' and date '{d1}' using sample 20000 rows),
             b as (select cast(trade_date as date) as trade_date, symbol_id, m, o, h, l, c, volume as v, oi
                   from read_parquet('{bars_glob}', hive_partitioning=true))
        select count(*) as n, count(*) filter (where b.o is null or b.o!=s.open or b.h!=s.high or b.l!=s.low
               or b.c!=s.close or b.v!=s.volume or b.oi!=s.oi) as bad
        from s left join b using (trade_date, symbol_id, m)""").fetchone()
    if ck[1]:
        errs.append(f"value spot-check: {ck[1]}/{ck[0]} rows differ")
    # 4. spot parity
    sp_src = con.sql(f"select count(*) from sp where trade_date between date '{d0}' and date '{d1}'").fetchone()[0]
    sp_out = con.sql(f"""select count(*) from read_parquet('{(root/"spot"/"trade_date=*"/"part*.parquet").as_posix()}',
        hive_partitioning=true) where trade_date between '{d0}' and '{d1}'""").fetchone()[0]
    if sp_src != sp_out:
        errs.append(f"spot rows {sp_out} != source {sp_src}")

    # manifest (checksums of every partition file)
    files = {}
    for kind in ("bars", "spot"):
        for p in sorted((root / kind).glob("trade_date=*/part*.parquet")):
            files[p.relative_to(root).as_posix()] = {"bytes": p.stat().st_size, "sha256": sha256(p)}
    manifest = {
        "schema_version": SCHEMA_VERSION, "asset": asset, "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "days": int(len(di)), "rows": int(di["n_rows"].sum()),
        "first_day": str(di["trade_date"].min()), "last_day": str(di["trade_date"].max()),
        "validation_errors": errs, "files": files,
    }
    tmp = root / "manifest.tmp"
    tmp.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    os.replace(tmp, root / "manifest.json")
    log(f"store rows={manifest['rows']:,} days={manifest['days']} first={manifest['first_day']} last={manifest['last_day']}")
    if errs:
        for e in errs:
            log("VALIDATION FAILED: " + e)
        sys.exit(1)
    log("validation OK (row parity, no dup keys, 20k-row value check, spot parity)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", default="NIFTY")
    ap.add_argument("--from", dest="d0", default="2021-08-01")
    ap.add_argument("--to", dest="d1", default="2026-12-31")
    a = ap.parse_args()
    build(a.asset, a.d0, a.d1)
