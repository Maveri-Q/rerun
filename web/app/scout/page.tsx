import { Seed } from "@/components/Seed";
import { scoutSeed } from "@/lib/seed";
import ScoutClient from "./ScoutClient";

export const revalidate = 60;

export default async function Page() {
  return (
    <Seed value={await scoutSeed()}>
      <ScoutClient />
    </Seed>
  );
}
