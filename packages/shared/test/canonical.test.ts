import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson, sha256Hex } from "../src/index.ts";

describe("canonicalJson", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("is independent of key insertion order", () => {
    expect(canonicalHash({ x: 1, y: [true, null] })).toBe(canonicalHash({ y: [true, null], x: 1 }));
  });

  it("escapes strings like JSON", () => {
    expect(canonicalJson({ s: 'a"b\n' })).toBe('{"s":"a\\"b\\n"}');
  });

  it("rejects values that JSON.stringify would drop or mangle", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(/unsupported/);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
