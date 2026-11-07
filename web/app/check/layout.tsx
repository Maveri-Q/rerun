import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Check a paper", "Paste a paragraph from a paper and see which of its numbers can be checked.", "/check");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
