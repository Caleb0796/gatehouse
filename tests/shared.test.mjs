import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/shared/hash.js";
import { assertShape } from "../src/shared/schema.js";

test("sha256Hex known vector", async () => {
  assert.equal(await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("assertShape passes and rejects", () => {
  assertShape({ a: 1, b: "x" }, { a: "number", b: "string" });
  assert.throws(() => assertShape({ a: "no" }, { a: "number" }));
  assert.throws(() => assertShape(null, {}));
});
