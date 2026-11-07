import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Try it now", "Practice on a demo claim with made-up data, and watch the whole cycle in minutes.", "/try");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
