import vm from "node:vm";
import { normalizeDecimal } from "@rerun/shared";

/**
 * Pulls the metric out of an output file, in code. The LLM may suggest *where* to look, but
 * this function always produces the number.
 */

export type ExtractorType = "jsonpath" | "regex" | "csv_cell";

export const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Returns a canonical decimal string. Throws with a reason if the value cannot be found. */
export function extractMetric(content: string, type: ExtractorType, expr: string): string {
  const raw = type === "jsonpath" ? jsonPath(content, expr) : type === "regex" ? regex(content, expr) : csvCell(content, expr);
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`extracted value is not a number: ${JSON.stringify(raw)?.slice(0, 60)}`);
  }
  return normalizeDecimal(raw);
}

/** Subset of JSONPath: `$.a.b[0]["c d"]`. */
function jsonPath(content: string, expr: string): unknown {
  if (!expr.startsWith("$")) throw new Error("jsonpath must start with $");
  let node: unknown = JSON.parse(content);
  const token = /\.([A-Za-z_][\w-]*)|\[(\d+)\]|\["([^"]+)"\]/y;
  token.lastIndex = 1;
  while (token.lastIndex < expr.length) {
    const m = token.exec(expr);
    if (!m) throw new Error(`unsupported jsonpath: ${expr}`);
    const key = m[1] ?? m[3] ?? Number(m[2]);
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) throw new Error(`jsonpath ${expr} not found`);
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/** First capture group (or the whole match). Bounded, because the output file is untrusted. */
function regex(content: string, expr: string): string {
  const context = { content, expr, found: null as string | null };
  vm.runInNewContext("{ const m = new RegExp(expr).exec(content); found = m ? (m[1] ?? m[0]) : null; }", context, { timeout: 2000 });
  if (context.found === null) throw new Error(`regex ${expr} did not match`);
  return context.found;
}

/** `row:column`: row is 0-based excluding the header (negative counts from the end); column is a header name or index. */
function csvCell(content: string, expr: string): string {
  const m = /^(-?\d+):(.+)$/.exec(expr);
  if (!m) throw new Error(`csv_cell expr must be row:column, got ${expr}`);
  const [header, ...rows] = content.split(/\r?\n/).filter((l) => l.trim() !== "").map(parseCsvLine);
  if (!header) throw new Error("csv is empty");
  const rowIndex = Number(m[1]);
  const row = rows[rowIndex < 0 ? rows.length + rowIndex : rowIndex];
  if (!row) throw new Error(`csv has no row ${rowIndex}`);
  const named = header.indexOf(m[2]!);
  const col = named >= 0 ? named : /^\d+$/.test(m[2]!) ? Number(m[2]) : -1;
  const cell = row[col];
  if (cell === undefined) throw new Error(`csv has no column ${m[2]}`);
  return cell;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells.map((s) => s.trim());
}
