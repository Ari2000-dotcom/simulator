use anyhow::{Context, Result};
use arrow_array::{Array, Float32Array, Int32Array, RecordBatch, StringArray};
use arrow_cast::cast;
use arrow_schema::DataType;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use std::fs::File;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug)]
pub struct Sym {
    pub kind: u8, // 0 = OPT, 1 = FUT
    pub expiry: i32,
    pub strike: i32, // paise
    pub opt: u8,     // 0 = CE, 1 = PE, 2 = none
}

#[derive(Clone, Copy, Debug)]
pub struct DayInfo {
    pub date: i32,
    pub n_symbols: u32,
}

pub struct Store {
    pub root: PathBuf,
    pub dim: Vec<Option<Sym>>, // indexed by symbol_id
    pub days: Vec<DayInfo>,
}

pub fn read_batches(path: &Path) -> Result<Vec<RecordBatch>> {
    let f = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(f)?.with_batch_size(1 << 16).build()?;
    let mut v = Vec::new();
    for b in reader {
        v.push(b?);
    }
    Ok(v)
}

pub fn col_i32(b: &RecordBatch, name: &str) -> Result<Int32Array> {
    let c = b.column_by_name(name).with_context(|| format!("column {name}"))?;
    let a = cast(c, &DataType::Int32)?;
    Ok(a.as_any().downcast_ref::<Int32Array>().unwrap().clone())
}

pub fn col_f32(b: &RecordBatch, name: &str) -> Result<Float32Array> {
    let c = b.column_by_name(name).with_context(|| format!("column {name}"))?;
    let a = cast(c, &DataType::Float32)?;
    Ok(a.as_any().downcast_ref::<Float32Array>().unwrap().clone())
}

pub fn col_str(b: &RecordBatch, name: &str) -> Result<StringArray> {
    let c = b.column_by_name(name).with_context(|| format!("column {name}"))?;
    let a = cast(c, &DataType::Utf8)?;
    Ok(a.as_any().downcast_ref::<StringArray>().unwrap().clone())
}

/// Date-like column (Date32 or Timestamp) -> yyyymmdd ints.
pub fn col_date(b: &RecordBatch, name: &str) -> Result<Vec<i32>> {
    let c = b.column_by_name(name).with_context(|| format!("column {name}"))?;
    let d = cast(c, &DataType::Date32)?;
    let s = cast(&d, &DataType::Utf8)?;
    let s = s.as_any().downcast_ref::<StringArray>().unwrap();
    Ok((0..s.len()).map(|i| parse_date(s.value(i))).collect())
}

pub fn parse_date(s: &str) -> i32 {
    let p: Vec<&str> = s.split('-').collect();
    if p.len() < 3 {
        return 0;
    }
    p[0].parse::<i32>().unwrap_or(0) * 10000 + p[1].parse::<i32>().unwrap_or(0) * 100 + p[2][..2.min(p[2].len())].parse::<i32>().unwrap_or(0)
}

pub fn fmt_date(d: i32) -> String {
    format!("{:04}-{:02}-{:02}", d / 10000, (d / 100) % 100, d % 100)
}

/// Days since 1970-01-01 for yyyymmdd (civil calendar).
pub fn days_from_ymd(d: i32) -> i64 {
    let (y, m, dd) = ((d / 10000) as i64, ((d / 100) % 100) as i64, (d % 100) as i64);
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn weekday(d: i32) -> &'static str {
    // 1970-01-01 was a Thursday
    const N: [&str; 7] = ["THU", "FRI", "SAT", "SUN", "MON", "TUE", "WED"];
    N[days_from_ymd(d).rem_euclid(7) as usize]
}

impl Store {
    pub fn open(root: &Path) -> Result<Store> {
        let mut dim: Vec<Option<Sym>> = Vec::new();
        for b in read_batches(&root.join("dim_symbol.parquet"))? {
            let id = col_i32(&b, "symbol_id")?;
            let kind = col_str(&b, "kind")?;
            let exp = col_date(&b, "expiry")?;
            let strike = col_i32(&b, "strike")?;
            let opt = col_str(&b, "opt_type")?;
            for i in 0..b.num_rows() {
                let sid = id.value(i) as usize;
                if dim.len() <= sid {
                    dim.resize(sid + 1, None);
                }
                dim[sid] = Some(Sym {
                    kind: if kind.value(i) == "OPT" { 0 } else { 1 },
                    expiry: exp[i],
                    strike: strike.value(i),
                    opt: match opt.value(i) {
                        "CE" => 0,
                        "PE" => 1,
                        _ => 2,
                    },
                });
            }
        }
        let mut days = Vec::new();
        for b in read_batches(&root.join("day_index.parquet"))? {
            let d = col_date(&b, "trade_date")?;
            let n = col_i32(&b, "n_symbols")?;
            for i in 0..b.num_rows() {
                days.push(DayInfo { date: d[i], n_symbols: n.value(i) as u32 });
            }
        }
        days.sort_by_key(|d| d.date);
        Ok(Store { root: root.to_path_buf(), dim, days })
    }

    pub fn bars_path(&self, date: i32) -> PathBuf {
        self.root.join("bars").join(format!("trade_date={}", fmt_date(date))).join("part0.parquet")
    }
    pub fn spot_path(&self, date: i32) -> PathBuf {
        self.root.join("spot").join(format!("trade_date={}", fmt_date(date))).join("part0.parquet")
    }
    pub fn day_pos(&self, date: i32) -> Option<usize> {
        self.days.binary_search_by_key(&date, |d| d.date).ok()
    }
}
