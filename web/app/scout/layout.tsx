import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("The scout", "An AI agent finds research anyone can retrace, and a person decides what goes live.", "/scout");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
