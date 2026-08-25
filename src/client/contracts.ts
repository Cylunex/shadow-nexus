import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { ComponentType } from "react";
import type { NexusBootstrap } from "../contracts.js";
import type { NexusLayoutState } from "./layout-state.js";
import type { NexusNavigationStore } from "./navigation.js";

export type NexusModuleGroup = "home" | "domains" | "agent" | "system";

export interface NexusAskContext {
  readonly module: string;
  readonly topic?: string;
  readonly range?: string;
}

export interface NexusPageProps {
  readonly sessionId: string | undefined;
  readonly sessions: ISessions;
  readonly data: NexusBootstrap;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly reload: () => Promise<void>;
  readonly navigate: (route: string) => void;
  readonly showConversation: () => void;
  readonly ask: (text: string, context?: NexusAskContext) => Promise<void>;
}

export interface NexusModuleContext {
  readonly sessionId: string | undefined;
  readonly data: NexusBootstrap;
}

export interface NexusModuleDescriptor {
  readonly id: `${string}:${string}`;
  readonly apiVersion: 1;
  readonly title: string;
  readonly route: string;
  readonly icon: string;
  readonly group: NexusModuleGroup;
  readonly order?: number;
  readonly scope: "root" | "session";
  readonly page: ComponentType<NexusPageProps>;
  readonly available?: (context: NexusModuleContext) => boolean;
  readonly badge?: (context: NexusModuleContext) => string | number | undefined;
}

export interface NexusModuleRegistry {
  registerModule(module: NexusModuleDescriptor): () => void;
  getSnapshot(): readonly NexusModuleDescriptor[];
  subscribe(listener: () => void): () => void;
}

export interface NexusLayoutService {
  toggleSidebar(): void;
  openDetails(): void;
  closeDetails(): void;
}

export interface NexusRootInjected {
  readonly layout: NexusLayoutState;
  readonly modules: NexusModuleRegistry;
  readonly navigation: NexusNavigationStore;
  readonly sessions: ISessions;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    layout: NexusLayoutService;
    shadowNexus: NexusModuleRegistry;
  }
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "sidebar": { kind: "single"; scope: "root"; owner: { readonly collapsed: boolean; readonly width: number } };
    "conversation": { kind: "single"; scope: "session-maybe"; owner: Record<never, never> };
    "details": { kind: "single"; scope: "session"; owner: Record<never, never> };
    "shell.overlay": { kind: "list"; scope: "root" };
  }
}
