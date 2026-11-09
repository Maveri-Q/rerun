export const BINS: { label: string; why: string; test: RegExp }[] = [
  { label: "No code to run", why: "The paper doesn't point to a GitHub repository.", test: /doesn't link to a GitHub/i },
  { label: "No licence", why: "Without an open licence, we can't rerun and publish it.", test: /licen[cs]e/i },
  { label: "Needs a graphics card", why: "The Lab only has ordinary processors.", test: /graphics card|gpu/i },
  { label: "Wrong language", why: "The Lab runs Python and R. MATLAB and C++ are out.", test: /^Mostly |only runs Python/i },
  { label: "Too big", why: "It wouldn't finish in a short, cheap run.", test: /too big/i },
  { label: "No data included", why: "With no dataset, there's nothing to run the code on.", test: /No small public dataset/i },
  { label: "Paper not free to read", why: "Without the paper's text, its number can't be checked.", test: /free copy/i },
  { label: "Number didn't check out", why: "The AI's number wasn't in the paper, or a second AI picked a different one.", test: /Two AIs|doesn't state that number|one clear number/i },
  { label: "Too niche", why: "Few people outside the field would care.", test: /Relatability/i },
];

/** Which bin a turned-down paper lands in. Anything new goes in the last one rather than being hidden. */
export function binOf(reasons: string[]): number {
  const text = reasons.join(" ");
  const found = BINS.findIndex((b) => b.test.test(text));
  return found === -1 ? BINS.length : found;
}
