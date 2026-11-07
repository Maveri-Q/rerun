import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Suggest a paper", "Suggest a published paper with public code and data for the Lab to re-run.", "/create");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
