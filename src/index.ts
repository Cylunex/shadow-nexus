import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import z from "@deepseek-ai/schemastery";
import { createNexusState, registerNexusHttp } from "./http.js";

export { NEXUS_PROTOCOL_VERSION } from "./contracts.js";
export { assertTrustedRequest } from "./http.js";
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
  registerNexusHttp(context, createNexusState());
}

export default { name, inject, Config, apply };
