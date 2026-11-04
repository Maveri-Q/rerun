import path from "node:path";
import { config } from "dotenv";

const root = path.resolve(import.meta.dirname, "../../..");

/**
 * Loads .env.testnet (generated accounts and Lab keys), then the repo-root .env, regardless of
 * which package directory a script runs from. Earlier files win, so an empty `TESTNET_...=` line
 * copied from .env.example cannot hide a generated value.
 */
export function loadEnv(): void {
  config({ path: [path.join(root, ".env.testnet"), path.join(root, ".env")], quiet: true });
}
