import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Leaderboard", "Who forecasts best whether research holds up.", "/leaderboard");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
