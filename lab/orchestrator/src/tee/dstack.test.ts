import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { KeyPair, type KeyPairString } from "near-api-js";
import { openSealed, sealToLab } from "@rerun/shared";
import { describe, expect, it } from "vitest";
import { deriveLabKeys, reportData, teeIdentity } from "./dstack.ts";

const appKey = Buffer.alloc(32, 9);

describe("keys made inside the secure hardware", () => {
  it("are the same every start, so the Lab account keeps working", () => {
    expect(deriveLabKeys(appKey)).toEqual(deriveLabKeys(appKey));
    expect(deriveLabKeys(Buffer.alloc(32, 8)).nearPublicKey).not.toBe(deriveLabKeys(appKey).nearPublicKey);
  });

  it("give a working NEAR key and a working private-data key", () => {
    const keys = deriveLabKeys(appKey);
    const pair = KeyPair.fromString(keys.nearPrivateKey as KeyPairString);
    expect(pair.getPublicKey().toString()).toBe(keys.nearPublicKey);
    const message = new Uint8Array([1, 2, 3]);
    expect(pair.verify(message, pair.sign(message).signature)).toBe(true);
    const sealed = sealToLab(Buffer.from("private rows"), keys.encPublicKey);
    expect(Buffer.from(openSealed(sealed, keys.encPrivateKey, keys.encPublicKey)).toString()).toBe("private rows");
  });

  it("asks for a quote over the Lab account and both public keys", async () => {
    const asked: Record<string, unknown> = {};
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        asked[req.url!] = JSON.parse(body);
        const answers: Record<string, unknown> = {
          "/GetKey": { key: appKey.toString("hex"), signature_chain: [] },
          "/Info": { app_id: "0xaa", compose_hash: "0x" + "c".repeat(64) },
          "/GetQuote": { quote: "0x0102", event_log: "[]" },
        };
        res.end(JSON.stringify(answers[req.url!]));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const { keys, attestation } = await teeIdentity(`http://127.0.0.1:${port}`, "lab.testnet");
      const expected = reportData("lab.testnet", keys).toString("hex");
      expect(asked["/GetQuote"]).toEqual({ report_data: expected });
      expect(attestation).toMatchObject({ compose_hash: "c".repeat(64), quote: "0102", report_data: expected, near_public_key: keys.nearPublicKey });
      expect(JSON.stringify(attestation)).not.toContain(keys.nearPrivateKey.slice(8));
      expect(JSON.stringify(attestation)).not.toContain(keys.encPrivateKey);
    } finally {
      server.close();
    }
  });
});
