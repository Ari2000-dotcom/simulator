"""Benchmark: short ATM straddle 09:20 -> 15:15 on nearest expiry, 2024-2026.
Cube path (numpy mmap)  vs  DuckDB over the old per-expiry files (E:\\Dataset\\full_1m)."""
import sys, time, os
import numpy as np
import duckdb

sys.path.insert(0, os.path.dirname(__file__))
from store import Store, M0

ENTRY, EXIT = 560, 915          # 09:20, 15:15
st = Store("NIFTY")

# ---- cube path ----
t = time.perf_counter()
pts, days = [], []
for y in (2024, 2025, 2026):
    c = st.cube(y)
    h = c.half
    ce = np.asarray(c.c[:, 0, 0, h, :])          # [day, minute]  nearest expiry, CE, ATM
    pe = np.asarray(c.c[:, 0, 1, h, :])
    e, x = ENTRY - M0, EXIT - M0
    ok = (ce[:, e] > 0) & (pe[:, e] > 0) & (ce[:, x] > 0) & (pe[:, x] > 0)
    pnl = (ce[:, e] + pe[:, e] - ce[:, x] - pe[:, x]) / 100.0
    pts.append(pnl[ok]); days.append(np.array(c.dates)[ok])
cube_t = time.perf_counter() - t
pnl_c = np.concatenate(pts); dates_c = np.concatenate(days)
print(f"CUBE   : {len(pnl_c)} trades, total {pnl_c.sum():,.1f} pts, time {cube_t*1000:.0f} ms")

# ---- one-day parquet load ----
t = time.perf_counter(); df = st.day("2026-10-15"); print(f"load_day: {df.height:,} rows in {(time.perf_counter()-t)*1000:.0f} ms")

# ---- duckdb on the old layout (same logic) ----
con = duckdb.connect()
con.sql("set TimeZone='Asia/Kolkata'; set memory_limit='8GB'; set temp_directory='D:/Dataset_bt/_tmp'")
t = time.perf_counter()
q = r"""
with o as (select cast(ts as date) d, expiry, strike, opt_type, hour(ts)*60+minute(ts) m, close
           from read_parquet('E:/Dataset/full_1m/asset=NIFTY/year=*/*.parquet')
           where kind='OPT' and cast(ts as date) >= date '2024-01-01'),
sp as (select cast(ts as date) d, round(close/5000.0)*5000 atm from read_parquet('E:/Dataset/full_1m/asset=NIFTY/spot/*.parquet')
       where hour(ts)*60+minute(ts)=555),
ne as (select d, min(expiry) e from o where expiry>=d group by 1),
leg as (select o.d, o.opt_type, o.m, o.close from o join sp using(d) join ne on ne.d=o.d and ne.e=o.expiry
        where o.strike = sp.atm and o.m in (560,915))
select d, sum(case when m=560 then close else -close end) as pnl
from leg group by d having count(*)=4 order by d"""
r = con.sql(q).df()
duck_t = time.perf_counter() - t
pnl_d = r["pnl"].to_numpy() / 100.0
print(f"DUCKDB : {len(pnl_d)} trades, total {pnl_d.sum():,.1f} pts, time {duck_t*1000:.0f} ms")
print(f"speedup: {duck_t/cube_t:,.0f}x   trades match: {len(pnl_d)==len(pnl_c)}   total diff: {abs(pnl_d.sum()-pnl_c.sum()):.2f} pts")
