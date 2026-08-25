import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useNexusBootstrap } from "./api.js";
import type { NexusModuleContext, NexusModuleGroup, NexusModuleRegistry } from "./contracts.js";
import { NexusModuleBoundary } from "./module-boundary.js";
import type { NexusNavigationStore } from "./navigation.js";

const groupLabels: Record<NexusModuleGroup, string> = {
  home: "工作台",
  domains: "领域",
  agent: "Agent",
  system: "系统"
};

export interface NexusWorkspaceProps {
  readonly sessionId: string | undefined;
  readonly sessions: ISessions;
  readonly modules: NexusModuleRegistry;
  readonly navigation: NexusNavigationStore;
}

export function NexusWorkspace({ sessionId, sessions, modules, navigation }: NexusWorkspaceProps) {
  const { data, loading, error, reload } = useNexusBootstrap(sessionId);
  const subscribeModules = useCallback((listener: () => void) => modules.subscribe(listener), [modules]);
  const readModules = useCallback(() => modules.getSnapshot(), [modules]);
  const registered = useSyncExternalStore(subscribeModules, readModules, readModules);
  const subscribeNavigation = useCallback((listener: () => void) => navigation.subscribe(listener), [navigation]);
  const readNavigation = useCallback(() => navigation.getSnapshot(), [navigation]);
  const location = useSyncExternalStore(subscribeNavigation, readNavigation, readNavigation);
  const context: NexusModuleContext = { sessionId, data };
  const available = registered.filter((module) => module.scope === "root" || sessionId !== undefined)
    .filter((module) => module.available?.(context) !== false);
  const active = available.find((module) => module.route === location.route) ?? available.find((module) => module.route === "today") ?? available[0];

  useEffect(() => {
    if (active !== undefined && active.route !== location.route) navigation.navigate(active.route, true);
  }, [active, location.route, navigation]);

  const navigate = useCallback((route: string) => { navigation.navigate(route); }, [navigation]);
  const showConversation = useCallback(() => { navigation.showConversation(); }, [navigation]);
  const Page = active?.page;
  const activeId = active?.id;
  const grouped = Object.entries(groupLabels).map(([group, label]) => ({
    group: group as NexusModuleGroup,
    label,
    modules: available.filter((module) => module.group === group)
  })).filter((item) => item.modules.length > 0);

  return <div className="sn-app">
    <aside className="sn-sidebar">
      <div className="sn-brand"><span>S</span><div><strong>SHADOW</strong><small>NEXUS</small></div></div>
      <nav aria-label="Nexus 导航">
        {grouped.map((item) => <section key={item.group} className="sn-nav-group">
          <h2>{item.label}</h2>
          {item.modules.map((module) => {
            const badge = module.badge?.(context);
            return <button type="button" key={module.id} data-active={active?.id === module.id} onClick={() => navigate(module.route)}>
              <i>{module.icon}</i><span>{module.title}</span>{badge !== undefined && badge !== 0 ? <b>{badge}</b> : null}
            </button>;
          })}
        </section>)}
      </nav>
      <button className="sn-conversation-entry" type="button" onClick={showConversation}><i>⌁</i><span>对话</span><small>完整 DSH Conversation</small></button>
      <footer><span className="sn-orbit"><i /></span><div><strong>{sessionId === undefined ? "Shadow" : "当前会话"}</strong><small>{loading ? "同步中" : error === undefined ? sessionId === undefined ? "等待选择 DSH Session" : "DSH Session 已连接" : "连接异常"}</small></div></footer>
    </aside>
    <main className="sn-main">
      {error !== undefined && <div className="sn-alert"><span>!</span><p>{error}</p><button type="button" onClick={() => { void reload(); }}>重试</button></div>}
      {Page === undefined || activeId === undefined
        ? <div className="sn-page"><div className="sn-empty"><h2>没有可用模块</h2></div></div>
        : <NexusModuleBoundary key={activeId} moduleId={activeId}>
          <Page sessionId={sessionId} sessions={sessions} data={data} loading={loading} error={error} reload={reload} navigate={navigate} showConversation={showConversation} />
        </NexusModuleBoundary>}
    </main>
  </div>;
}
