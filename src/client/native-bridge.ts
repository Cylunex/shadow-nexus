export interface ShadowNativeBridge {
  readonly schemaVersion: 1;
  readonly moduleId: "nexus";
  readonly capabilities: readonly string[];
  request(capability: string, operation: string, payload: Readonly<Record<string, unknown>>): Promise<unknown>;
}

type BridgeWindow = typeof globalThis & { readonly ShadowNativeBridge?: unknown };

export function readShadowNativeBridge(scope: BridgeWindow = globalThis as BridgeWindow): ShadowNativeBridge | undefined {
  const value = scope.ShadowNativeBridge;
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<ShadowNativeBridge>;
  if (candidate.schemaVersion !== 1 || candidate.moduleId !== "nexus"
    || !Array.isArray(candidate.capabilities) || candidate.capabilities.some((item) => typeof item !== "string")
    || typeof candidate.request !== "function") return undefined;
  return candidate as ShadowNativeBridge;
}

export function bridgeCan(bridge: ShadowNativeBridge | undefined, capability: string): bridge is ShadowNativeBridge {
  return bridge !== undefined && bridge.capabilities.includes(capability);
}

export async function requestNative<T>(
  bridge: ShadowNativeBridge | undefined,
  capability: string,
  operation: string,
  payload: Readonly<Record<string, unknown>> = {}
): Promise<T> {
  if (!bridgeCan(bridge, capability)) throw new Error(`native_capability_unavailable:${capability}`);
  return await bridge.request(capability, operation, payload) as T;
}
