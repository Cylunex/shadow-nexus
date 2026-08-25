export type NexusSurface = "nexus" | "conversation";

export interface NexusNavigationSnapshot {
  readonly surface: NexusSurface;
  readonly route: string;
}

const DEFAULT_SNAPSHOT: NexusNavigationSnapshot = Object.freeze({ surface: "nexus", route: "today" });
const ROUTE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

function routeValue(value: string | null): string {
  return value !== null && ROUTE_PATTERN.test(value) ? value : "today";
}

export function parseNexusNavigation(url: URL): NexusNavigationSnapshot {
  return Object.freeze({
    surface: url.searchParams.get("surface") === "conversation" ? "conversation" : "nexus",
    route: routeValue(url.searchParams.get("view"))
  });
}

export function writeNexusNavigation(url: URL, snapshot: NexusNavigationSnapshot): URL {
  const next = new URL(url);
  if (snapshot.surface === "nexus") next.searchParams.delete("surface");
  else next.searchParams.set("surface", snapshot.surface);
  if (snapshot.route === "today") next.searchParams.delete("view");
  else next.searchParams.set("view", snapshot.route);
  return next;
}

export class NexusNavigationStore {
  private snapshot: NexusNavigationSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.snapshot = typeof location === "undefined" ? DEFAULT_SNAPSHOT : parseNexusNavigation(new URL(location.href));
  }

  getSnapshot(): NexusNavigationSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  listen(): () => void {
    if (typeof addEventListener === "undefined") return () => {};
    const onPopState = (): void => {
      this.replace(parseNexusNavigation(new URL(location.href)));
    };
    addEventListener("popstate", onPopState);
    return () => { removeEventListener("popstate", onPopState); };
  }

  navigate(route: string, replace = false): void {
    if (!ROUTE_PATTERN.test(route)) throw new Error(`Nexus route is invalid: ${route}`);
    this.commit({ surface: "nexus", route }, replace);
  }

  showConversation(): void {
    this.commit({ ...this.snapshot, surface: "conversation" }, false);
  }

  showNexus(): void {
    this.commit({ ...this.snapshot, surface: "nexus" }, false);
  }

  private commit(next: NexusNavigationSnapshot, replace: boolean): void {
    if (typeof history !== "undefined" && typeof location !== "undefined") {
      const url = writeNexusNavigation(new URL(location.href), next);
      if (replace) history.replaceState(history.state, "", url);
      else history.pushState(history.state, "", url);
    }
    this.replace(Object.freeze(next));
  }

  private replace(next: NexusNavigationSnapshot): void {
    if (next.surface === this.snapshot.surface && next.route === this.snapshot.route) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
