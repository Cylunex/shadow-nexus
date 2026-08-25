import type { NexusModuleDescriptor, NexusModuleRegistry } from "./contracts.js";

const ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/u;
const ROUTE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

function compareModules(left: NexusModuleDescriptor, right: NexusModuleDescriptor): number {
  const groups = ["home", "domains", "agent", "system"];
  const group = groups.indexOf(left.group) - groups.indexOf(right.group);
  if (group !== 0) return group;
  const order = (left.order ?? 0) - (right.order ?? 0);
  return order !== 0 ? order : left.title.localeCompare(right.title, "zh-CN");
}

export class DefaultNexusModuleRegistry implements NexusModuleRegistry {
  private readonly modules = new Map<string, NexusModuleDescriptor>();
  private snapshot: readonly NexusModuleDescriptor[] = Object.freeze([]);
  private readonly listeners = new Set<() => void>();

  registerModule(module: NexusModuleDescriptor): () => void {
    if (module.apiVersion !== 1) throw new Error(`Unsupported Nexus module API: ${String(module.apiVersion)}`);
    if (!ID_PATTERN.test(module.id)) throw new Error(`Nexus module id is invalid: ${module.id}`);
    if (!ROUTE_PATTERN.test(module.route)) throw new Error(`Nexus module route is invalid: ${module.route}`);
    if (this.modules.has(module.id)) throw new Error(`Nexus module is already registered: ${module.id}`);
    if ([...this.modules.values()].some((item) => item.route === module.route)) {
      throw new Error(`Nexus module route is already registered: ${module.route}`);
    }
    this.modules.set(module.id, Object.freeze({ ...module }));
    this.publish();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.modules.delete(module.id);
      this.publish();
    };
  }

  getSnapshot(): readonly NexusModuleDescriptor[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    this.snapshot = Object.freeze([...this.modules.values()].sort(compareModules));
    for (const listener of this.listeners) listener();
  }
}
