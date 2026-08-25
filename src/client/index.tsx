import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-theme/client";
import { NexusLayoutState } from "./layout-state.js";
import { DefaultNexusModuleRegistry } from "./module-registry.js";
import { NexusNavigationStore } from "./navigation.js";
import styles from "./nexus.css?inline";
import { builtinNexusModules } from "./pages.js";
import { NexusRoot } from "./root.js";
import { NexusThemePresenter } from "./theme-presenter.js";

export * from "./contracts.js";
export { NexusLayoutState } from "./layout-state.js";
export { DefaultNexusModuleRegistry } from "./module-registry.js";
export { NexusNavigationStore, parseNexusNavigation, writeNexusNavigation } from "./navigation.js";

export const name = "shadow-nexus";
export const inject = ["slots", "sessions", "theme"];

function installStyles(): () => void {
  document.querySelector<HTMLStyleElement>("style[data-shadow-nexus]")?.remove();
  const element = document.createElement("style");
  element.dataset.shadowNexus = "true";
  element.textContent = styles;
  document.head.append(element);
  document.body.dataset.shadowNexusRoot = "true";
  return () => {
    element.remove();
    delete document.body.dataset.shadowNexusRoot;
  };
}

export function apply(context: ClientContext): void {
  const layout = new NexusLayoutState();
  const modules = new DefaultNexusModuleRegistry();
  const navigation = new NexusNavigationStore();

  context.effect(() => installStyles(), "shadow-nexus: root styles");
  context.effect(() => navigation.listen(), "shadow-nexus: browser navigation");
  context.effect(() => {
    const disposeLayout = context.reflect.provide("layout", layout);
    const disposeModules = context.reflect.provide("shadowNexus", modules);
    return () => {
      void disposeModules();
      void disposeLayout();
    };
  }, "shadow-nexus: layout and module services");
  context.effect(() => {
    const disposers = builtinNexusModules().map((module) => modules.registerModule(module));
    return () => { for (const dispose of disposers.reverse()) dispose(); };
  }, "shadow-nexus: built-in modules");
  context.effect(() => {
    const presenter = new NexusThemePresenter();
    presenter.apply(context.theme.getTheme());
    const off = context.on("theme/change", (snapshot) => { presenter.apply(snapshot); });
    return () => {
      off();
      presenter.dispose();
    };
  }, "shadow-nexus: theme presenter");
  context.effect(() => context.slots.register({
    name: "root",
    children: {
      "sidebar": { kind: "single", scope: "root" },
      "conversation": { kind: "single", scope: "session-maybe" },
      "details": { kind: "single", scope: "session" },
      "shell.overlay": { kind: "list", scope: "root" }
    },
    inject: () => ({ layout, modules, navigation, sessions: context.sessions })
  }, NexusRoot), "shadow-nexus: root shell");
}

export default { name, inject, apply };
