import { Seed } from "@/components/Seed";
import { homeSeed } from "@/lib/seed";
import HomeClient from "./HomeClient";

export const revalidate = 60;

export default async function Page() {
  return (
    <Seed value={await homeSeed()}>
      <HomeClient />
    </Seed>
  );
}
