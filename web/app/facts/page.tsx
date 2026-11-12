import { Seed } from "@/components/Seed";
import { pageMeta } from "@/lib/meta";
import { factsSeed } from "@/lib/seed";
import FactsClient from "./FactsClient";

export const revalidate = 60;
export const metadata = pageMeta("Verified facts", "Published results the Lab has retraced, with what each one means and what wasn't checked.", "/facts");

export default async function Page() {
  return (
    <Seed value={await factsSeed()}>
      <FactsClient />
    </Seed>
  );
}
