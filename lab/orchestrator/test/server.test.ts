import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGithubUrl } from "../src/lab/draft.ts";
import { startLabServer } from "../src/lab/server.ts";
import { createQueue, EventHub, readHashed } from "../src/lab/store.ts";

const hub = new EventHub();
const RUN = `test-${Date.now().toString(36)}`;
let server: Server;
let base: string;

beforeAll(async () => {
  server = startLabServer(0, {
    hub,
    publicUrl: "http://lab.test",
    exclusive: createQueue(),
    resolverFor: () => {
      throw new Error("not used");
    },
    labCodehash: "0".repeat(64),
    labAccount: "lab.testnet",
    modelId: "fake/model",
    dryRunEnabled: false,
    info: { network: "testnet", tee: false },
  });
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  server.closeAllConnections();
});

describe("Lab HTTP server", () => {
  it("reports health and whether dry runs are on", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ ok: true, dry_run: false, tee: false });
  });

  it("streams a run: the connection opens at once, replays history, then pushes live events", async () => {
    hub.publish(RUN, { stage: "fetching", message: "old event" });
    const controller = new AbortController();
    const res = await fetch(`${base}/runs/${RUN}/stream`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("old event");
    hub.publish(RUN, { stage: "done", message: "new event" });
    await readUntil("new event");
    expect(text).toContain('"stage":"done"');
    controller.abort();
  });

  it("serves a run's history and lists it in the feed", async () => {
    hub.publish(RUN, { stage: "done", message: "listed" });
    const history = (await (await fetch(`${base}/runs/${RUN}`)).json()) as { message: string }[];
    expect(history.at(-1)?.message).toBe("listed");
    const feed = (await (await fetch(`${base}/runs?limit=50`)).json()) as { run: string }[];
    expect(feed.some((f) => f.run === RUN)).toBe(true);
  });

  it("does not leak files through crafted names", async () => {
    expect(readHashed("reports", "../../../.env")).toBeNull();
    expect(readHashed("logs", "a".repeat(63))).toBeNull();
    expect((await fetch(`${base}/reports/..%2F..%2F.env`)).status).toBe(404);
    expect((await fetch(`${base}/runs/..%2F..%2F.env`)).status).toBe(200); // an empty history, no file content
    expect(await (await fetch(`${base}/runs/..%2F..%2F.env`)).json()).toEqual([]);
  });

  it("refuses dry runs unless the operator turned them on", async () => {
    const res = await fetch(`${base}/dry-run`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
  });

  it("stores sealed uploads by content hash and returns a reference", async () => {
    const res = await fetch(`${base}/sealed`, { method: "POST", body: Buffer.from(`RRN1-test-${RUN}`) });
    const { ref } = (await res.json()) as { ref: string };
    expect(ref).toMatch(/^http:\/\/lab\.test\/sealed\/[0-9a-f]{64}$/);
    const hash = ref.split("/").pop()!;
    const back = await fetch(`${base}/sealed/${hash}`);
    expect(Buffer.from(await back.arrayBuffer()).toString()).toBe(`RRN1-test-${RUN}`);
  });

  it("returns 404 for anything else", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe("parseGithubUrl", () => {
  it("accepts repository URLs only", () => {
    expect(parseGithubUrl("https://github.com/octocat/Hello-World")).toEqual({ owner: "octocat", repo: "Hello-World" });
    expect(parseGithubUrl("https://github.com/octocat/Hello-World.git/")).toEqual({ owner: "octocat", repo: "Hello-World" });
    for (const bad of ["", "http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a", "https://github.com/a/b/tree/main"]) {
      expect(parseGithubUrl(bad)).toBeNull();
    }
  });
});

describe("createQueue", () => {
  it("runs jobs one at a time, and a failure does not block the next", async () => {
    const queue = createQueue();
    const order: string[] = [];
    const job = (name: string, ms: number, fail = false) =>
      queue(async () => {
        order.push(`${name} start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name} end`);
        if (fail) throw new Error("boom");
      });
    const a = job("a", 30, true);
    const b = job("b", 1);
    await expect(a).rejects.toThrow("boom");
    await b;
    expect(order).toEqual(["a start", "a end", "b start", "b end"]);
  });
});
