import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../src/surface/gate.js";

function verdict(green, reason, reproSha256) {
  return { green, reason, reproSha256 };
}

test("matching green verdict opens and binds the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("assert(add(2, 2) === 4)");

  const state = gate.onVerdict(verdict(true, "REGRESSION_DEMONSTRATED", draftSha));

  assert.equal(state.gateOpen, true);
  assert.equal(state.boundSha, draftSha);
});

test("editing an open gate closes it and clears the binding", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("first draft");
  gate.onVerdict(verdict(true, "REGRESSION_DEMONSTRATED", draftSha));

  const state = await gate.setDraft("edited draft");

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("green verdict for a previous draft does not open the gate", async () => {
  const gate = createGate();
  const { draftSha: previousSha } = await gate.setDraft("first draft");
  await gate.setDraft("current draft");

  const state = gate.onVerdict(verdict(true, "REGRESSION_DEMONSTRATED", previousSha));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("PASS_BOTH verdict does not open the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("");

  const state = gate.onVerdict(verdict(false, "PASS_BOTH", draftSha));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("INVERTED verdict does not open the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("version-sniffed repro");

  const state = gate.onVerdict(verdict(false, "INVERTED", draftSha));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("repeating the same green verdict is idempotent", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("stable repro");
  const green = verdict(true, "REGRESSION_DEMONSTRATED", draftSha);
  const opened = gate.onVerdict(green);

  const repeated = gate.onVerdict(green);

  assert.deepEqual(repeated, opened);
});

test("a closed gate can reopen after a new matching green verdict", async () => {
  const gate = createGate();
  const { draftSha: firstSha } = await gate.setDraft("first repro");
  gate.onVerdict(verdict(true, "REGRESSION_DEMONSTRATED", firstSha));
  const { draftSha: secondSha } = await gate.setDraft("second repro");

  const state = gate.onVerdict(verdict(true, "REGRESSION_DEMONSTRATED", secondSha));

  assert.equal(state.gateOpen, true);
  assert.equal(state.boundSha, secondSha);
  assert.notEqual(state.boundSha, firstSha);
});
