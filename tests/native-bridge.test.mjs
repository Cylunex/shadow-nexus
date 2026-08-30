import assert from "node:assert/strict";
import test from "node:test";
import { bridgeCan, readShadowNativeBridge, requestNative } from "../lib/index.js";

test("accepts only the Nexus Promise bridge with declared capabilities", async () => {
  const calls = [];
  const scope = { ShadowNativeBridge: {
    schemaVersion: 1,
    moduleId: "nexus",
    capabilities: ["web", "operations"],
    request: async (capability, operation, payload) => { calls.push({ capability, operation, payload }); return { id: "queued-1" }; }
  } };
  const bridge = readShadowNativeBridge(scope);
  assert.equal(bridgeCan(bridge, "operations"), true);
  assert.equal(bridgeCan(bridge, "media"), false);
  assert.deepEqual(await requestNative(bridge, "operations", "offline.enqueue", { action: { domain: "alpha" } }), { id: "queued-1" });
  assert.deepEqual(calls, [{ capability: "operations", operation: "offline.enqueue", payload: { action: { domain: "alpha" } } }]);
  await assert.rejects(requestNative(bridge, "media", "capture.get"), /native_capability_unavailable/u);
});

test("rejects stale, foreign, and synchronous bridge shapes", () => {
  assert.equal(readShadowNativeBridge({ ShadowNativeBridge: { schemaVersion: 0, moduleId: "nexus", capabilities: [], request() {} } }), undefined);
  assert.equal(readShadowNativeBridge({ ShadowNativeBridge: { schemaVersion: 1, moduleId: "health", capabilities: ["media"], request: async () => ({}) } }), undefined);
  assert.equal(readShadowNativeBridge({ ShadowNativeBridge: { schemaVersion: 1, moduleId: "nexus", capabilities: [1], request: async () => ({}) } }), undefined);
});
