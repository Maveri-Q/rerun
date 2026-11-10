import { Seed } from "@/components/Seed";
import { leaderboardSeed } from "@/lib/seed";
import LeaderboardClient from "./LeaderboardClient";

export const revalidate = 60;

export default async function Page() {
  return (
    <Seed value={await leaderboardSeed()}>
      <LeaderboardClient />
    </Seed>
  );
}
