import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@rerun/shared"],
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default config;
