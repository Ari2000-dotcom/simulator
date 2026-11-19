"""Loader API for the research store.   from store import Store;  s = Store('NIFTY')

  s.day(date)                 -> polars DataFrame of every bar that day, joined with dim_symbol
  s.days(d0, d1, cols=None)   -> lazy polars scan across dates (partition pruned)
  s.chain_at(date, m)         -> option chain snapshot at minute-of-day m (555 = 09:15)
  s.cube(year)                -> Cube (memory-mapped numpy arrays, see build_cubes.py)

Prices are int32 paise (divide by 100 for rupees). m = minute of day, IST.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import polars as pl

ROOT = Path(r"D:/Dataset_bt")
M0, M1 = 555, 939           # 09:15 .. 15:39 inclusive -> 385 minute slots in the cubes
NMIN = M1 - M0 + 1


class Cube:
    """Per-year memory-mapped arrays. Axes: [day, rank, side, slot, minute]; side 0=CE 1=PE; slot 15 = ATM at open.
    0 means 'no data'. rank 0 = nearest expiry >= day, rank 1 = next one."""

    FIELDS = ("o", "h", "l", "c", "volume", "oi")

    def __init__(self, d: Path):
        self.dir = d
        meta = json.loads((d / "meta.json").read_text())
        self.dates = np.array(meta["dates"])
        self.half = meta["half"]
        self.step = meta["step"]
        self.expiry = np.load(d / "expiry.npy", mmap_mode="r")      # [day, rank] yyyymmdd int32
        self.atm = np.load(d / "atm.npy", mmap_mode="r")            # [day] strike paise at open
        self.spot = np.load(d / "spot_c.npy", mmap_mode="r")        # [day, minute]
        for f in self.FIELDS:
            setattr(self, f, np.load(d / f"{f}.npy", mmap_mode="r"))

    def strike(self, day: int, slot: int) -> int:
        return int(self.atm[day]) + (slot - self.half) * self.step


class Store:
    def __init__(self, asset: str = "NIFTY", root: Path = ROOT):
        self.root = root / f"asset={asset}"
        self.dim = pl.read_parquet(self.root / "dim_symbol.parquet")
        self._days = None

    def trading_days(self) -> list[str]:
        if self._days is None:
            self._days = pl.read_parquet(self.root / "day_index.parquet")["trade_date"].cast(pl.Date).dt.strftime("%Y-%m-%d").to_list()
        return self._days

    def _bars(self, date: str) -> pl.DataFrame:
        return pl.read_parquet(self.root / "bars" / f"trade_date={date}" / "part0.parquet")

    def day(self, date: str) -> pl.DataFrame:
        return self._bars(date).join(self.dim, on="symbol_id")

    def days(self, d0: str, d1: str) -> pl.LazyFrame:
        lf = pl.scan_parquet(str(self.root / "bars" / "trade_date=*" / "part*.parquet"), hive_partitioning=True)
        return lf.filter((pl.col("trade_date") >= d0) & (pl.col("trade_date") <= d1)).join(self.dim.lazy(), on="symbol_id")

    def spot_day(self, date: str) -> pl.DataFrame:
        return pl.read_parquet(self.root / "spot" / f"trade_date={date}" / "part0.parquet")

    def chain_at(self, date: str, m: int) -> pl.DataFrame:
        return self.day(date).filter((pl.col("m") == m) & (pl.col("kind") == "OPT"))

    def cube(self, year: int) -> Cube:
        return Cube(self.root / "cubes" / f"year={year}")
