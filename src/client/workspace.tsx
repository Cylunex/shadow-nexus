import { type ISessions, type SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { askNexus, captureNexus } from "./assistant.js";
import { useNexusBootstrap } from "./api.js";
import type { NexusAskContext, NexusModuleContext, NexusModuleGroup, NexusModuleRegistry } from "./contracts.js";
import type { NexusLayoutState } from "./layout-state.js";
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
  readonly sessionTitle: string | undefined;
  readonly sessionOptions: readonly { readonly id: string; readonly title: string }[];
  readonly sessions: ISessions;
  readonly layout: NexusLayoutState;
  readonly modules: NexusModuleRegistry;
  readonly navigation: NexusNavigationStore;
}

interface AssistantBarProps {
  readonly sessionId: string | undefined;
  readonly sessionTitle: string | undefined;
  readonly ask: (text: string) => Promise<void>;
  readonly capture: (text: string) => Promise<void>;
}

function AssistantBar({ sessionId, sessionTitle, ask, capture }: AssistantBarProps) {
  const [mode, setMode] = useState<"ask" | "capture">("ask");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (sessionId === undefined || text.trim() === "") return;
    setBusy(true);
    try {
      if (mode === "ask") await ask(text);
      else await capture(text);
      setText("");
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败。");
    } finally {
      setBusy(false);
    }
  }
  return <section className="sn-assistant-bar" data-mode={mode}>
    <div className="sn-assistant-modes"><button type="button" data-active={mode === "ask"} onClick={() => setMode("ask")}>问一下</button><button type="button" data-active={mode === "capture"} onClick={() => setMode("capture")}>记一下</button></div>
    <textarea rows={1} maxLength={4000} value={text} disabled={sessionId === undefined || busy} placeholder={sessionId === undefined ? "先选择一个工作台会话" : mode === "ask" ? `在「${sessionTitle ?? sessionId}」中聊聊…` : "记录一条需要确认的信息…"} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
      }
    }} />
    <button className="sn-assistant-send" type="button" disabled={sessionId === undefined || busy || text.trim() === ""} onClick={() => { void submit(); }}>{busy ? "…" : "发送"}</button>
    <small>{mode === "ask" ? "只读交流，不写入领域事实" : "生成草稿，Review 后才交给领域应用"}</small>
    {error !== undefined && <p>{error}</p>}
  </section>;
}

export function NexusWorkspace({ sessionId, sessionTitle, sessionOptions, sessions, layout, modules, navigation }: NexusWorkspaceProps) {
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
  const ask = useCallback(async (text: string, askContext?: NexusAskContext) => {
    if (sessionId === undefined) throw new Error("请先选择一个工作台会话。");
    await askNexus(sessions, sessionId, text, askContext ?? { module: active?.route ?? "today" });
    layout.openAssistant();
  }, [active?.route, layout, sessionId, sessions]);
  const capture = useCallback(async (text: string) => {
    if (sessionId === undefined) throw new Error("请先选择一个工作台会话。");
    await captureNexus(sessions, sessionId, text);
    await reload();
    navigation.navigate("review");
  }, [navigation, reload, sessionId, sessions]);
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
      <button className="sn-conversation-entry" type="button" onClick={showConversation}><i>⌁</i><span>对话</span><small>{sessionId === undefined ? "先选择工作台会话" : `在「${sessionTitle ?? sessionId}」中继续`}</small></button>
      <footer><span className="sn-orbit"><i /></span><div><strong>{sessionTitle ?? "Shadow"}</strong><small>{loading ? "同步中" : error === undefined ? sessionId === undefined ? "等待选择 DSH Session" : "工作台会话已连接" : "连接异常"}</small></div></footer>
    </aside>
    <main className="sn-main">
      <header className="sn-workspace-session">
        <div><span className="sn-orbit"><i /></span><p><small>工作台会话 · 跟随 DSH 当前选择</small><strong>{sessionTitle ?? "尚未选择会话"}</strong></p></div>
        <label><span>切换</span><select value={sessionId ?? ""} onChange={(event) => {
          if (event.target.value === "") sessions.clear();
          else sessions.open(event.target.value as SessionId);
        }}><option value="">未选择</option>{sessionOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
        <button type="button" onClick={showConversation}>{sessionId === undefined ? "打开会话并新建" : `在「${sessionTitle ?? sessionId}」中展开`}</button>
      </header>
      {error !== undefined && <div className="sn-alert"><span>!</span><p>{error}</p><button type="button" onClick={() => { void reload(); }}>重试</button></div>}
      {Page === undefined || activeId === undefined
        ? <div className="sn-page"><div className="sn-empty"><h2>没有可用模块</h2></div></div>
        : <NexusModuleBoundary key={activeId} moduleId={activeId}>
          <Page sessionId={sessionId} sessions={sessions} data={data} loading={loading} error={error} reload={reload} navigate={navigate} showConversation={showConversation} ask={ask} />
        </NexusModuleBoundary>}
    </main>
    <AssistantBar sessionId={sessionId} sessionTitle={sessionTitle} ask={(text) => ask(text)} capture={capture} />
  </div>;
}
