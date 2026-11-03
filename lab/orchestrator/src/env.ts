import path from "node:path";
import { config } from "dotenv";

const root = path.resolve(import.meta.dirname, "../../..");

/**
 * Loads the repo-root .env, then .env.testnet (accounts from `pnpm testnet:accounts`),
 * regardless of which package directory a script runs from. Earlier files win.
 */
export function loadEnv(): void {
  config({ path: [path.join(root, ".env"), path.join(root, ".env.testnet")], quiet: true });
}
