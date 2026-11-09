import { describe, expect, it } from "vitest";
import { hostLimits } from "./docker.ts";

describe("sandbox limits on a small machine", () => {
  it("gives a claim what it asks for when the host sets no cap", () => {
    expect(hostLimits(2, 4, {})).toEqual({ cpus: 2, memGb: 4, capped: false });
  });

  it("caps a claim to what the machine can spare, and says so", () => {
    expect(hostLimits(2, 4, { SANDBOX_MAX_MEM_GB: "3", SANDBOX_MAX_CPUS: "2" })).toEqual({ cpus: 2, memGb: 3, capped: true });
    expect(hostLimits(1, 1, { SANDBOX_MAX_MEM_GB: "3" })).toEqual({ cpus: 1, memGb: 1, capped: false });
  });
});
