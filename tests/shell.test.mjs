import assert from "node:assert/strict";
import test from "node:test";
import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import {
  DefaultNexusModuleRegistry,
  NexusLayoutState,
  parseNexusNavigation,
  writeNexusNavigation
} from "../lib/index.js";

test("root shell declares the complete native conversation topology", () => {
  const slots = new SlotCore();
  slots.register({
    name: "root",
    registrant: "shadow-nexus",
    children: {
      sidebar: { kind: "single", scope: "root" },
      conversation: { kind: "single", scope: "session-maybe" },
      details: { kind: "single", scope: "session" },
      "shell.overlay": { kind: "list", scope: "root" }
    }
  }, () => null);
  assert.deepEqual(slots.snapshot("root")[0].children.map((child) => [child.name, child.kind, child.scope]), [
    ["sidebar", "single", "root"],
    ["conversation", "single", "session-maybe"],
    ["details", "single", "session"],
    ["shell.overlay", "list", "root"]
  ]);
  assert.throws(() => slots.register({ name: "root" }, () => null), /already has a registration/u);
});

test("parses and writes stable Nexus surface routes", () => {
  assert.deepEqual(parseNexusNavigation(new URL("https://nexus.example/")), { surface: "nexus", route: "today" });
  assert.deepEqual(parseNexusNavigation(new URL("https://nexus.example/?surface=conversation&view=review")), { surface: "conversation", route: "review" });
  assert.equal(writeNexusNavigation(new URL("https://nexus.example/?other=1"), { surface: "conversation", route: "capture" }).search, "?other=1&surface=conversation&view=capture");
  assert.equal(writeNexusNavigation(new URL("https://nexus.example/?surface=conversation&view=capture"), { surface: "nexus", route: "today" }).search, "");
});

test("layout compatibility service publishes sidebar, details, and assistant transitions", () => {
  const layout = new NexusLayoutState();
  let changes = 0;
  const off = layout.subscribe(() => { changes += 1; });
  layout.toggleSidebar();
  assert.equal(layout.getSnapshot().sidebarOpen, false);
  layout.openDetails();
  layout.openDetails();
  assert.equal(layout.getSnapshot().detailsOpen, true);
  layout.openAssistant();
  layout.openAssistant();
  assert.equal(layout.getSnapshot().assistantOpen, true);
  layout.closeAssistant();
  assert.equal(layout.getSnapshot().detailsOpen, false);
  assert.equal(layout.getSnapshot().assistantOpen, false);
  assert.equal(changes, 4);
  off();
});

test("module registry orders contributions and releases routes", () => {
  const registry = new DefaultNexusModuleRegistry();
  const page = () => null;
  const disposeLater = registry.registerModule({ id: "test:later", apiVersion: 1, title: "Later", route: "later", icon: "L", group: "domains", order: 20, scope: "root", page });
  registry.registerModule({ id: "test:first", apiVersion: 1, title: "First", route: "first", icon: "F", group: "home", order: 10, scope: "root", page });
  assert.deepEqual(registry.getSnapshot().map((item) => item.route), ["first", "later"]);
  assert.throws(() => registry.registerModule({ id: "test:duplicate", apiVersion: 1, title: "Duplicate", route: "first", icon: "D", group: "home", scope: "root", page }), /already registered/u);
  disposeLater();
  assert.deepEqual(registry.getSnapshot().map((item) => item.route), ["first"]);
});
