//! Black-76 with r = 0. All prices in rupees, T in years.

fn ncdf(x: f64) -> f64 {
    0.5 * (1.0 + libm::erf(x / std::f64::consts::SQRT_2))
}
fn npdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / (2.0 * std::f64::consts::PI).sqrt()
}

pub fn intrinsic(f: f64, k: f64, call: bool) -> f64 {
    if call { (f - k).max(0.0) } else { (k - f).max(0.0) }
}

pub fn price(f: f64, k: f64, t: f64, sigma: f64, call: bool) -> f64 {
    if t <= 0.0 || sigma <= 0.0 {
        return intrinsic(f, k, call);
    }
    let sd = sigma * t.sqrt();
    let d1 = ((f / k).ln() + 0.5 * sd * sd) / sd;
    let d2 = d1 - sd;
    if call { f * ncdf(d1) - k * ncdf(d2) } else { k * ncdf(-d2) - f * ncdf(-d1) }
}

/// Implied vol by bisection. None if the price is below intrinsic or not bracketable.
pub fn implied_vol(p: f64, f: f64, k: f64, t: f64, call: bool) -> Option<f64> {
    if p <= 0.0 || t <= 0.0 || p < intrinsic(f, k, call) - 1e-9 {
        return None;
    }
    let (mut lo, mut hi) = (1e-4, 5.0);
    if price(f, k, t, hi, call) < p || price(f, k, t, lo, call) > p {
        return None;
    }
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if price(f, k, t, mid, call) < p { lo = mid } else { hi = mid }
    }
    Some(0.5 * (lo + hi))
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Greeks {
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64, // rupees per calendar day, per unit
    pub vega: f64,  // rupees per 1 vol point, per unit
}

pub fn greeks(f: f64, k: f64, t: f64, sigma: f64, call: bool) -> Greeks {
    if t <= 0.0 || sigma <= 0.0 {
        let itm = if call { f > k } else { f < k };
        let d = if itm { if call { 1.0 } else { -1.0 } } else { 0.0 };
        return Greeks { delta: d, ..Default::default() };
    }
    let sd = sigma * t.sqrt();
    let d1 = ((f / k).ln() + 0.5 * sd * sd) / sd;
    let delta = if call { ncdf(d1) } else { ncdf(d1) - 1.0 };
    let gamma = npdf(d1) / (f * sd);
    let theta_year = -f * npdf(d1) * sigma / (2.0 * t.sqrt());
    Greeks { delta, gamma, theta: theta_year / 365.0, vega: f * npdf(d1) * t.sqrt() / 100.0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_iv() {
        let p = price(22400.0, 22500.0, 7.0 / 365.0, 0.14, true);
        let iv = implied_vol(p, 22400.0, 22500.0, 7.0 / 365.0, true).unwrap();
        assert!((iv - 0.14).abs() < 1e-6);
    }
    #[test]
    fn parity() {
        let (f, k, t, s) = (100.0, 95.0, 0.1, 0.2);
        let c = price(f, k, t, s, true);
        let p = price(f, k, t, s, false);
        assert!((c - p - (f - k)).abs() < 1e-9);
    }
}
