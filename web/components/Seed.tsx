"use client";

import type { ReactNode } from "react";
import { SeedContext } from "./seed-context";

export function Seed({ value, children }: { value: Record<string, unknown>; children: ReactNode }) {
  return <SeedContext.Provider value={value}>{children}</SeedContext.Provider>;
}
