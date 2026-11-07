import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("My forecasts", "Your forecasts, your points and what you can collect.", "/portfolio");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
