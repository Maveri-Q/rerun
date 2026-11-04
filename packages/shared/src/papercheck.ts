/**
 * Paper-only checks: recalculates statistics from the numbers printed in a paper, so it needs no
 * code or data and no AI. A flag means "someone should look", never "this paper is wrong".
 *
 * Two established ideas: recomputing p-values from reported test statistics (as statcheck does),
 * and the GRIM test, which spots means that are impossible for whole-number data.
 */

const ALPHA = 0.05;

// ---------------------------------------------------------------- distributions

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularised incomplete beta function I_x(a, b). */
function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(x, a, b)) / a : 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const small = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < small ? small : d);
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < small ? small : d);
    c = 1 + aa / c;
    c = Math.abs(c) < small ? small : c;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < small ? small : d);
    c = 1 + aa / c;
    c = Math.abs(c) < small ? small : c;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

/** Upper regularised incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  const small = 1e-300;
  let b = x + 1 - a;
  let c = 1 / small;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    d = 1 / (Math.abs(d) < small ? small : d);
    c = b + an / c;
    c = Math.abs(c) < small ? small : c;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

export type TestType = "t" | "F" | "chi2" | "r" | "z";

/** Two-sided p-value for t, r and z; upper-tail p-value for F and chi-square. */
export function pValue(test: TestType, stat: number, df1: number, df2 = 0): number {
  switch (test) {
    case "t":
      return betaI(df1 / (df1 + stat * stat), df1 / 2, 0.5);
    case "F":
      return stat <= 0 ? 1 : betaI(df2 / (df2 + df1 * stat), df2 / 2, df1 / 2);
    case "chi2":
      return gammaQ(df1 / 2, stat / 2);
    case "r": {
      if (Math.abs(stat) >= 1) return 0;
      const t = stat * Math.sqrt(df1 / (1 - stat * stat));
      return betaI(df1 / (df1 + t * t), df1 / 2, 0.5);
    }
    case "z":
      return gammaQ(0.5, (stat * stat) / 2);
  }
}

// ---------------------------------------------------------------- parsing

export type StatResult = "consistent" | "one_sided" | "inconsistent" | "changes_conclusion";

export interface StatFinding {
  kind: "statistic";
  /** The text as printed in the paper. */
  text: string;
  test: TestType;
  computedP: number;
  result: StatResult;
}

export interface MeanFinding {
  kind: "mean";
  text: string;
  mean: number;
  n: number;
  possible: boolean;
}

export interface PaperCheck {
  statistics: StatFinding[];
  means: MeanFinding[];
  flagged: number;
}

const NUM = String.raw`[-−–]?\d*\.?\d+`;
const P_PART = String.raw`[,;:]?\s*(?:two-tailed\s*)?p\s*([<=>≤≥])\s*(\d*\.?\d+)`;
const STAT_PATTERNS: { test: TestType; re: RegExp }[] = [
  { test: "t", re: new RegExp(String.raw`\bt\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUM})${P_PART}`, "gi") },
  { test: "F", re: new RegExp(String.raw`\bF\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUM})${P_PART}`, "gi") },
  { test: "chi2", re: new RegExp(String.raw`(?:χ\s*[²2]|chi[- ]?squared?|chi2|x2)\s*\(\s*(\d+)(?:\s*,\s*N\s*=\s*\d+)?\s*\)\s*=\s*(${NUM})${P_PART}`, "gi") },
  { test: "r", re: new RegExp(String.raw`\br\s*\(\s*(\d+)\s*\)\s*=\s*(${NUM})${P_PART}`, "gi") },
  { test: "z", re: new RegExp(String.raw`\bz\s*=\s*(${NUM})${P_PART}`, "gi") },
];

const toNumber = (s: string) => Number(s.replace(/[−–]/, "-"));
const decimalsOf = (s: string) => (s.split(".")[1] ?? "").length;

function classify(test: TestType, statText: string, df1: number, df2: number, op: string, pText: string): { computedP: number; result: StatResult } {
  const stat = toNumber(statText);
  const reported = Number(pText);
  const half = 0.5 * 10 ** -decimalsOf(statText);
  // The statistic was rounded when printed, so any value that rounds to it is fair.
  const a = pValue(test, Math.abs(stat) - half, df1, df2);
  const b = pValue(test, Math.abs(stat) + half, df1, df2);
  const pLow = Math.min(a, b);
  const pHigh = Math.max(a, b);
  const computedP = pValue(test, Math.abs(stat), df1, df2);

  const agrees = (low: number, high: number): boolean => {
    if (op === "<" || op === "≤") return low < reported;
    if (op === ">" || op === "≥") return high > reported;
    const halfP = 0.5 * 10 ** -decimalsOf(pText);
    return high >= reported - halfP && low <= reported + halfP;
  };

  if (agrees(pLow, pHigh)) return { computedP, result: "consistent" };
  if ((test === "t" || test === "z" || test === "r") && agrees(pLow / 2, pHigh / 2)) return { computedP, result: "one_sided" };
  const reportedSignificant = op === ">" || op === "≥" ? false : reported <= ALPHA;
  return { computedP, result: reportedSignificant !== computedP < ALPHA ? "changes_conclusion" : "inconsistent" };
}

/** Is this mean possible for `n` whole-number values, once rounded as printed? (GRIM) */
export function grimPossible(meanText: string, n: number): boolean {
  const mean = Number(meanText);
  const decimals = decimalsOf(meanText);
  const nearest = Math.round(mean * n);
  for (const total of [nearest - 1, nearest, nearest + 1]) {
    if ((total / n).toFixed(decimals) === mean.toFixed(decimals)) return true;
  }
  return false;
}

/** Means printed close to a sample size, such as "M = 3.45, SD = 1.2, n = 20". */
const MEAN_RE = /\bM\s*=\s*(\d*\.\d+)(?:[^;]{0,30}?)\bn\s*=\s*(\d+)/gi;

export function checkPaperText(text: string): PaperCheck {
  const statistics: StatFinding[] = [];
  for (const { test, re } of STAT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const g = m.slice(1);
      const [df1, df2, statText, op, pText] =
        test === "F" ? [Number(g[0]), Number(g[1]), g[2]!, g[3]!, g[4]!] : test === "z" ? [0, 0, g[0]!, g[1]!, g[2]!] : [Number(g[0]), 0, g[1]!, g[2]!, g[3]!];
      const { computedP, result } = classify(test, statText, df1, df2, op, pText);
      statistics.push({ kind: "statistic", text: m[0].replace(/\s+/g, " ").trim(), test, computedP, result });
    }
  }
  const means: MeanFinding[] = [];
  for (const m of text.matchAll(MEAN_RE)) {
    const n = Number(m[2]);
    // With more people than the rounding can tell apart, every mean is possible: no test to run.
    if (n <= 0 || n >= 10 ** decimalsOf(m[1]!)) continue;
    means.push({ kind: "mean", text: m[0].replace(/\s+/g, " ").trim(), mean: Number(m[1]), n, possible: grimPossible(m[1]!, n) });
  }
  const flagged = statistics.filter((s) => s.result === "inconsistent" || s.result === "changes_conclusion").length + means.filter((x) => !x.possible).length;
  return { statistics, means, flagged };
}
