import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import z from "@deepseek-ai/schemastery";
import { createAssetGateway } from "./assets.js";
import { createDomainGateway } from "./domains.js";
import { createNexusState, registerNexusHttp } from "./http.js";

export { NEXUS_PROTOCOL_VERSION } from "./contracts.js";
export { AssetGatewayError, HttpAssetGateway, createAssetGateway, sanitizeAssetFilename } from "./assets.js";
export { nexusBasePathFromPluginUrl } from "./client-path.js";
export { NexusLayoutState } from "./client/layout-state.js";
export { DefaultNexusModuleRegistry } from "./client/module-registry.js";
export { parseNexusNavigation, writeNexusNavigation } from "./client/navigation.js";
export { assertTrustedRequest, createContextPack, createMemory, createNexusState, handleNexusRequest } from "./http.js";
export * from "./domains.js";
export * from "./proposals.js";
export * from "./projection.js";

export const name = "shadow-nexus";
export const inject = ["webServer"];

export interface Config {
  readonly enabled?: boolean;
}

export const Config = z.object({
  enabled: z.boolean().default(true)
}) as z<Config>;

export function apply(context: Context, config: Config = {}): void {
  if (config.enabled === false) return;
  registerNexusHttp(context, createNexusState(), createDomainGateway(), createAssetGateway());
}

export default { name, inject, Config, apply };
