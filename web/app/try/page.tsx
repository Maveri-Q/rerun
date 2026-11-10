import { Seed } from "@/components/Seed";
import { trySeed } from "@/lib/seed";
import TryClient from "./TryClient";

export const revalidate = 30;

export default async function Page() {
  return (
    <Seed value={await trySeed()}>
      <TryClient />
    </Seed>
  );
}
