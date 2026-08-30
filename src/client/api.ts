import { useCallback, useEffect, useRef, useState } from "react";
import type { NexusBootstrap } from "../contracts.js";
import { nexusBasePathFromPluginUrl } from "../client-path.js";

const fallback: NexusBootstrap = {
  protocol: "shadow.nexus.v1",
  mode: "preview",
  generatedAt: new Date(0).toISOString(),
  greeting: "欢迎来到 Shadow Nexus。",
  dateLabel: "正在连接 DSH",
  focus: "工作台正在读取当前会话的领域投影。",
  signals: [],
  domains: [],
  drafts: [],
  activity: [],
  trust: { total: 0, automatic: 0, manual: 0, rejected: 0, pending: 0, failed: 0, prohibited: 0, domains: [] },
  preferences: { notificationsEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00", sensitivePreviews: false, briefCadence: "daily" },
  brief: null,
  memories: [],
  contexts: [],
  suggestions: [],
  capabilities: { protocol: "unavailable", selected: 0, client: 0, deployed: 0, observed: 0, restoreTested: 0, failed: 0, attention: [] },
  assetUpload: { enabled: false, maxFilesPerMessage: 8 }
};

function nexusBasePath(): string {
  const script = document.querySelector<HTMLScriptElement>('script[src*="/plugins/@cylunex/shadow-nexus/client.js"]');
  return nexusBasePathFromPluginUrl(script?.src);
}

export function nexusEndpoint(path: string, sessionId?: string): string {
  const url = new URL(`${nexusBasePath()}/shadow-nexus/${path}`, globalThis.location.origin);
  if (sessionId !== undefined) url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export async function nexusJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { readonly error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`);
  return value;
}

export function useNexusBootstrap(sessionId: string | undefined) {
  const [data, setData] = useState<NexusBootstrap>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const request = useRef(0);

  const reload = useCallback(async () => {
    const current = request.current + 1;
    request.current = current;
    setLoading(true);
    try {
      const next = await nexusJson<NexusBootstrap>(await fetch(nexusEndpoint("bootstrap", sessionId), { cache: "no-store" }));
      if (request.current !== current) return;
      setData(next);
      setError(undefined);
    } catch (caught) {
      if (request.current !== current) return;
      setError(caught instanceof Error ? caught.message : "无法连接 Shadow Nexus。");
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
    return () => { request.current += 1; };
  }, [reload]);
  return { data, loading, error, reload };
}
