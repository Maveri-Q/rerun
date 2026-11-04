export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace.
 * The contract recomputes spec_hash from the same bytes, so this must stay
 * byte-for-byte stable. Non-finite numbers and undefined values are rejected
 * rather than silently dropped.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts = keys.map((k) => {
        if (obj[k] === undefined) throw new TypeError(`${path}.${k}: undefined`);
        return `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`;
      });
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: unsupported type ${typeof value}`);
  }
}

