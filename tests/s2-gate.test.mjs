import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../src/surface/gate.js";

function verdict(green, reason, reproSha256, stable) {
  return { green, reason, reproSha256, stable };
}

test("matching stable green verdict opens and binds the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("assert(add(2, 2) === 4)");

  const state = gate.onVerdict(verdict(true, "STABLE_LOCAL_DIFFERENTIAL", draftSha, true));

  assert.equal(state.gateOpen, true);
  assert.equal(state.boundSha, draftSha);
  assert.equal(state.tainted, false);
});

test("editing an open gate closes it and clears the binding", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("first draft");
  gate.onVerdict(verdict(true, "STABLE_LOCAL_DIFFERENTIAL", draftSha, true));

  const state = await gate.setDraft("edited draft");

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("green verdict for a previous draft does not open the gate", async () => {
  const gate = createGate();
  const { draftSha: previousSha } = await gate.setDraft("first draft");
  await gate.setDraft("current draft");

  const state = gate.onVerdict(verdict(true, "STABLE_LOCAL_DIFFERENTIAL", previousSha, true));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
});

test("UNSTABLE verdict does not open the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("flaky repro");

  const state = gate.onVerdict(verdict(false, "UNSTABLE", draftSha, false));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
  assert.equal(state.tainted, true);
});

test("single green verdict without stable does not open the gate", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("one-shot repro");

  const state = gate.onVerdict(verdict(true, "STABLE_LOCAL_DIFFERENTIAL", draftSha));

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
  assert.equal(state.tainted, false);
});

test("tainted draft cannot open on a later stable green verdict", async () => {
  const gate = createGate();
  const { draftSha } = await gate.setDraft("retry-until-lucky repro");
  gate.onVerdict(verdict(false, "PASS_BOTH", draftSha, true));

  const state = gate.onVerdict(
    verdict(true, "STABLE_LOCAL_DIFFERENTIAL", draftSha, true),
  );

  assert.equal(state.gateOpen, false);
  assert.equal(state.boundSha, null);
  assert.equal(state.tainted, true);
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
  const green = verdict(true, "STABLE_LOCAL_DIFFERENTIAL", draftSha, true);
  const opened = gate.onVerdict(green);

  const repeated = gate.onVerdict(green);

  assert.deepEqual(repeated, opened);
});

test("a closed gate can reopen after a new matching green verdict", async () => {
  const gate = createGate();
  const { draftSha: firstSha } = await gate.setDraft("first repro");
  gate.onVerdict(verdict(true, "STABLE_LOCAL_DIFFERENTIAL", firstSha, true));
  const { draftSha: secondSha } = await gate.setDraft("second repro");

  const state = gate.onVerdict(
    verdict(true, "STABLE_LOCAL_DIFFERENTIAL", secondSha, true),
  );

  assert.equal(state.gateOpen, true);
  assert.equal(state.boundSha, secondSha);
  assert.notEqual(state.boundSha, firstSha);
});
