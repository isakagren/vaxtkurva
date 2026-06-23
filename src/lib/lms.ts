// LMS calculation utilities for SvelteKit weight/growth curves tracker

export interface LMSEntry {
  x: number;
  l: number;
  m: number;
  s: number;
  sd3neg: number;
  sd2neg: number;
  sd1neg: number;
  sd0: number;
  sd1: number;
  sd2: number;
  sd3: number;
}

export interface LMSParams {
  l: number;
  m: number;
  s: number;
}

// Error function approximation (erf)
export function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));

  return sign * y;
}

// Normal Cumulative Distribution Function (CDF)
export function zToPercentile(z: number): number {
  const cdf = 0.5 * (1.0 + erf(z / Math.sqrt(2)));
  return cdf * 100;
}

// Linearly interpolate between two LMS entries
export function interpolateLMS(entries: LMSEntry[], x: number): LMSEntry {
  if (entries.length === 0) {
    throw new Error("LMS entries array is empty");
  }

  // Handle out of bounds
  if (x <= entries[0].x) {
    return { ...entries[0] };
  }
  if (x >= entries[entries.length - 1].x) {
    return { ...entries[entries.length - 1] };
  }

  // Find surrounding entries
  let i = 0;
  for (i = 0; i < entries.length - 1; i++) {
    if (entries[i].x <= x && x <= entries[i + 1].x) {
      break;
    }
  }

  const e1 = entries[i];
  const e2 = entries[i + 1];
  const t = (x - e1.x) / (e2.x - e1.x);

  // Interpolate values
  const l = e1.l + t * (e2.l - e1.l);
  const m = e1.m + t * (e2.m - e1.m);
  const s = e1.s + t * (e2.s - e1.s);

  return {
    x,
    l,
    m,
    s,
    sd3neg: e1.sd3neg + t * (e2.sd3neg - e1.sd3neg),
    sd2neg: e1.sd2neg + t * (e2.sd2neg - e1.sd2neg),
    sd1neg: e1.sd1neg + t * (e2.sd1neg - e1.sd1neg),
    sd0: e1.sd0 + t * (e2.sd0 - e1.sd0),
    sd1: e1.sd1 + t * (e2.sd1 - e1.sd1),
    sd2: e1.sd2 + t * (e2.sd2 - e1.sd2),
    sd3: e1.sd3 + t * (e2.sd3 - e1.sd3),
  };
}

// Calculate Z-score for a given value (weight, height, etc) at a specific age/x
export function calculateZScore(value: number, l: number, m: number, s: number): number {
  if (value <= 0 || m <= 0 || s <= 0) return 0;
  
  if (l !== 0) {
    return (Math.pow(value / m, l) - 1.0) / (l * s);
  } else {
    return Math.log(value / m) / s;
  }
}

// Calculate value for a given Z-score and LMS params
export function calculateValueForZScore(z: number, l: number, m: number, s: number): number {
  if (l !== 0) {
    const term = 1.0 + l * s * z;
    if (term <= 0) return 0; // Avoid imaginary roots
    return m * Math.pow(term, 1.0 / l);
  } else {
    return m * Math.exp(s * z);
  }
}
