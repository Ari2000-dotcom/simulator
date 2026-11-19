//! OPTLAB engine: read-only access to the research store, chain, legs, pricing, payoff, binary frames.
pub mod backtest;
pub mod config;
pub mod daybook;
pub mod frame;
pub mod legs;
pub mod pricing;
pub mod session;
pub mod store;

/// Minute slots per day: 09:15 .. 15:39 inclusive.
pub const NMIN: usize = 385;
/// First minute of day (09:15) as minute-of-day.
pub const M0: i32 = 555;
/// Expiry settles at 15:30 = minute-of-day 930.
pub const EXPIRY_MOD: i32 = 930;
/// Strike step in paise (50 index points).
pub const STEP: i32 = 5000;
