/**
 * Decimal strings and the reproduction comparator. This must stay identical to
 * contracts/rerun/src/math.rs: the contract repeats the comparison on every receipt and
 * rejects one whose outcome disagrees. Both sides are tested with the same vectors.
 */

export const DECIMAL_PLACES = 18;
const SCALE = 10n ** BigInt(DECIMAL_PLACES);
const MAX_INT_DIGITS = 20;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parses `-?digits(.digits)?` into a bigint scaled by 1e18. Throws on anything else. */
export function parseDecimal(s: string): bigint {
  if (!DECIMAL_RE.test(s)) throw new Error(`invalid decimal '${s}'`);
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "", frac = ""] = body.split(".");
  if (intPart.length > MAX_INT_DIGITS) throw new Error(`invalid decimal '${s}'`);
  if (frac.length > DECIMAL_PLACES) throw new Error(`invalid decimal '${s}' (max ${DECIMAL_PLACES} fractional digits)`);
  const value = BigInt(intPart) * SCALE + BigInt(frac.padEnd(DECIMAL_PLACES, "0") || "0");
  return negative ? -value : value;
}

export type ToleranceKind = "abs" | "rel";

const abs = (x: bigint) => (x < 0n ? -x : x);

/** `|measured - reported| <= tol` (abs) or `<= tol * |reported|` (rel), computed exactly. */
export function withinTolerance(measured: bigint, reported: bigint, kind: ToleranceKind, tol: bigint): boolean {
  const diff = abs(measured - reported);
  if (kind === "abs") return diff <= abs(tol);
  return diff * SCALE <= abs(tol) * abs(reported);
}

/**
 * Turns a number found in research output into a canonical decimal string the contract
 * accepts: expands exponents ("1.5e-3" -> "0.0015") and truncates past 18 fractional digits.
 * Throws for anything that is not a finite number.
 */
export function normalizeDecimal(input: string | number): string {
  const raw = (typeof input === "number" ? String(input) : input).trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m || (!m[2] && !m[3])) throw new Error(`not a number: '${raw.slice(0, 40)}'`);
  const negative = m[1] === "-";
  let intPart = m[2] ?? "";
  let frac = m[3] ?? "";
  const exp = Number(m[4] ?? 0);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 100) throw new Error(`exponent out of range: '${raw}'`);
  if (exp > 0) {
    const shifted = frac.padEnd(exp, "0");
    intPart += shifted.slice(0, exp);
    frac = shifted.slice(exp);
  } else if (exp < 0) {
    const padded = intPart.padStart(-exp + 1, "0");
    frac = padded.slice(exp) + frac;
    intPart = padded.slice(0, exp);
  }
  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
  frac = frac.slice(0, DECIMAL_PLACES).replace(/0+$/, "");
  const body = frac ? `${intPart}.${frac}` : intPart;
  const isZero = /^0(\.0*)?$/.test(body);
  const out = negative && !isZero ? `-${body}` : body;
  parseDecimal(out); // enforces the magnitude limit
  return out;
}
