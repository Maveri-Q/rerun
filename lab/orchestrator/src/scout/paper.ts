import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Finds and reads a paper's text, so the scout looks for the number where the paper states it rather
 * than guessing from a README. Visitors choose these addresses, so every hop is checked first: only
 * public https hosts, no redirects into a private network, and a limit on size and time. The text is
 * only ever data for a draft that a person then reviews.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_CHARS = 45_000;
const MAX_HOPS = 5;
const TIMEOUT_MS = 45_000;

export interface PaperText {
  text: string;
  /** Where the text was read from, for the person reviewing the draft. */
  from: string;
}

export type HostCheck = (host: string) => Promise<boolean>;
type Fetcher = typeof fetch;

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}

/** True only if every address the name points to is on the public internet. */
export const publicHost: HostCheck = async (host) => {
  const name = host.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.(localhost|local|internal|test)$/i.test(name)) return false;
  const addresses = isIP(name) ? [name] : (await lookup(name, { all: true })).map((a) => a.address);
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
};

async function get(url: string, fetcher: Fetcher, check: HostCheck): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const parsed = new URL(current);
    // DOI links often pass through an http address on the way to https, so a redirect may, but nothing is read from one.
    const allowed = parsed.protocol === "https:" || (hop > 0 && parsed.protocol === "http:");
    if (!allowed || !(await check(parsed.hostname).catch(() => false))) return null;
    const res = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "rerun-scout", accept: "application/pdf,text/html;q=0.9,*/*;q=0.5" } });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel().catch(() => {});
      current = new URL(next, current).toString();
      continue;
    }
    return res.ok && parsed.protocol === "https:" ? res : null;
  }
  return null;
}

async function bodyWithin(res: Response): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > MAX_BYTES ? null : bytes;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&minus;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Publishers name a page's PDF in a meta tag, which is often the only way from the page to the paper. */
export function pdfLinkIn(html: string, base: string): string | null {
  const tag = /<meta\b[^>]*name=["']citation_pdf_url["'][^>]*>/i.exec(html)?.[0];
  const href = tag && /content=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function read(url: string, fetcher: Fetcher, check: HostCheck, followPdfLink = true): Promise<PaperText | null> {
  const res = await get(url, fetcher, check);
  if (!res) return null;
  const bytes = await bodyWithin(res);
  if (!bytes) return null;
  const isPdf = /pdf/i.test(res.headers.get("content-type") ?? "") || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (isPdf) {
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    return text.trim().length > 200 ? { text: text.slice(0, MAX_CHARS), from: url } : null;
  }
  const html = new TextDecoder().decode(bytes);
  const pdf = followPdfLink ? pdfLinkIn(html, res.url || url) : null;
  if (pdf) {
    const fromPdf = await read(pdf, fetcher, check, false).catch(() => null);
    if (fromPdf) return fromPdf;
  }
  const text = htmlToText(html);
  // A short page is a landing page or a paywall, which says nothing about the paper's numbers.
  return text.length > 3000 ? { text: text.slice(0, MAX_CHARS), from: url } : null;
}

export function doiIn(url: string): string | null {
  return /\b(10\.\d{4,9}\/[^\s?#]+)/.exec(decodeURIComponent(url))?.[1]?.replace(/[.,)]+$/, "") ?? null;
}

interface OpenAccess {
  open_access?: { oa_url?: string | null };
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  locations?: { pdf_url?: string | null; landing_page_url?: string | null; is_oa?: boolean }[];
}

/** Free copies of the paper that OpenAlex knows about, best first. */
async function freeCopies(doi: string, fetcher: Fetcher, check: HostCheck): Promise<string[]> {
  const res = await get(`https://api.openalex.org/works/https://doi.org/${doi}?select=open_access,best_oa_location,locations`, fetcher, check).catch(() => null);
  if (!res) return [];
  const work = (await res.json()) as OpenAccess;
  const open = (work.locations ?? []).filter((l) => l.is_oa);
  return [work.best_oa_location?.pdf_url, ...open.map((l) => l.pdf_url), work.open_access?.oa_url, work.best_oa_location?.landing_page_url, ...open.map((l) => l.landing_page_url)].filter((u): u is string => Boolean(u));
}

/** The paper's text, or null if no free copy can be read. Failing here never rejects a paper by itself. */
export async function fetchPaperText(paperUrl: string, fetcher: Fetcher = fetch, check: HostCheck = publicHost): Promise<PaperText | null> {
  const doi = doiIn(paperUrl);
  const copies = [...(doi ? await freeCopies(doi, fetcher, check) : []), paperUrl];
  for (const url of [...new Set(copies)].slice(0, 6)) {
    const found = await read(url, fetcher, check).catch(() => null);
    if (found) return found;
  }
  return null;
}

/** Whether a number appears as written in the text, however the minus sign was typeset. */
export function numberInText(value: string, text: string): boolean {
  return numberPattern(value).test(unifyMinus(text));
}

const unifyMinus = (s: string) => s.replace(/[−‐-―]/g, "-");

function numberPattern(value: string, flags = ""): RegExp {
  const digits = value.trim().replace(/^[-−]/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sign = /^[-−]/.test(value.trim()) ? "-\\s?" : "";
  return new RegExp(`(^|[^\\d.-])${sign}${digits}(?![\\d])`, flags);
}

const COMMON_WORDS = new Set("about above after also among and are before below between but can does for from had has have how into its more not number paper percent per rate rather result results same show shows slow study than that the their them they this those through was were what when where which while who why will with would you your".split(" "));
/** How far from the number its wording may sit, in characters. Tables keep their headings at a distance. */
const NEAR_CHARS = 500;

/** The words that say what a number measures. Four letters are enough to match wage and wages. */
function meaningWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter((w) => !COMMON_WORDS.has(w)).map((w) => w.slice(0, 4)));
}

/**
 * Whether the number appears close to what the claim says it measures, at least once. A short number
 * like 2.2 can turn up anywhere in a paper, so being somewhere in the text proves little. At least
 * half of the wording's words, and never fewer than two, must sit around the number.
 */
export function numberNearWording(value: string, wording: string, text: string): boolean {
  const wanted = meaningWords(wording);
  if (wanted.size === 0) return false;
  const needed = Math.min(wanted.size, Math.max(2, Math.ceil(wanted.size / 2)));
  const plain = unifyMinus(text);
  for (const match of plain.matchAll(numberPattern(value, "g"))) {
    const around = meaningWords(plain.slice(Math.max(0, match.index - NEAR_CHARS), match.index + NEAR_CHARS));
    if ([...wanted].filter((w) => around.has(w)).length >= needed) return true;
  }
  return false;
}

/** Whether two numbers from a paper are the same value, however they were written. */
export function sameNumber(a: string, b: string): boolean {
  const read = (s: string) => Number(unifyMinus(s.trim()));
  return a.trim() !== "" && b.trim() !== "" && read(a) === read(b);
}
