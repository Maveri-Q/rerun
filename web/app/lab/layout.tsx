import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("The Lab", "The AI lab that re-runs research code and posts each result on NEAR.", "/lab");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
