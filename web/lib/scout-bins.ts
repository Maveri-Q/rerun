export const BINS: { label: string; why: string; test: RegExp }[] = [
  { label: "No code to run", why: "No code link in the paper.", test: /doesn't link to a GitHub/i },
  { label: "No licence", why: "We can't publish without one.", test: /licen[cs]e/i },
  { label: "Needs a graphics card", why: "The Lab has plain processors.", test: /graphics card|gpu/i },
  { label: "Wrong language", why: "Only Python and R run here.", test: /^Mostly |only runs Python/i },
  { label: "Too big", why: "Too slow for a short run.", test: /too big/i },
  { label: "No data included", why: "Nothing to run the code on.", test: /No small public dataset/i },
  { label: "Paper not free to read", why: "Its number can't be checked.", test: /free copy/i },
  { label: "Number didn't check out", why: "The two AIs didn't agree.", test: /Two AIs|doesn't state that number|one clear number/i },
  { label: "Too niche", why: "Few people would care.", test: /Relatability/i },
];

/** Which bin a turned-down paper lands in. Anything new goes in the last one rather than being hidden. */
export function binOf(reasons: string[]): number {
  const text = reasons.join(" ");
  const found = BINS.findIndex((b) => b.test.test(text));
  return found === -1 ? BINS.length : found;
}
