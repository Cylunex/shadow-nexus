import { type SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRenderSlots, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { NexusRootInjected } from "./contracts.js";
import { NexusWorkspace } from "./workspace.js";

export type NexusRootProps = PropsRuntime<"root">
  & PropsRenderSlots<"sidebar" | "conversation" | "details" | "shell.overlay">
  & NexusRootInjected;

export function NexusRoot({
  layout,
  modules,
  navigation,
  sessions,
  renderSlot,
  SessionProvider,
  useSessions
}: NexusRootProps) {
  const subscribeNavigation = useCallback((listener: () => void) => navigation.subscribe(listener), [navigation]);
  const readNavigation = useCallback(() => navigation.getSnapshot(), [navigation]);
  const route = useSyncExternalStore(subscribeNavigation, readNavigation, readNavigation);
  const subscribeLayout = useCallback((listener: () => void) => layout.subscribe(listener), [layout]);
  const readLayout = useCallback(() => layout.getSnapshot(), [layout]);
  const panels = useSyncExternalStore(subscribeLayout, readLayout, readLayout);
  const current = useSessions((state) => state.current);
  const ids = useSessions((state) => state.ids);
  const summaries = useSessions((state) => state.byId);
  const previousSession = useRef(current);

  useLayoutEffect(() => {
    if (previousSession.current !== current) layout.closeDetails();
    previousSession.current = current;
  }, [current, layout]);

  const nexusActive = route.surface === "nexus";
  const dockOpen = nexusActive && current !== undefined && panels.assistantOpen;
  const conversationMode = nexusActive ? dockOpen ? "dock" : "hidden" : "full";
  const sidebarOpen = !nexusActive && panels.sidebarOpen;
  const detailsOpen = !nexusActive && current !== undefined && panels.detailsOpen;

  useLayoutEffect(() => {
    if (dockOpen && panels.detailsOpen) navigation.showConversation();
  }, [dockOpen, navigation, panels.detailsOpen]);

  const sessionOptions = ids.map((id) => ({ id, title: summaries[id]?.displayTitle ?? id }));
  const sessionTitle = current === undefined ? undefined : summaries[current]?.displayTitle ?? current;
  return <div className="sn-root" data-surface={route.surface} data-assistant={conversationMode}>
    <section className="sn-root-surface sn-workbench-surface" data-active={nexusActive} aria-hidden={!nexusActive}>
      <NexusWorkspace sessionId={current} sessionTitle={sessionTitle} sessionOptions={sessionOptions} sessions={sessions} layout={layout} modules={modules} navigation={navigation} />
    </section>
    <section className="sn-root-surface sn-conversation-surface" data-mode={conversationMode} aria-hidden={conversationMode === "hidden"}>
      <header className="sn-conversation-toolbar">
        {conversationMode === "dock" ? <>
          <button className="sn-dock-close" type="button" aria-label="关闭对话面板" onClick={() => layout.closeAssistant()}>×</button>
          <div className="sn-conversation-title"><small>在当前会话中继续</small><strong>{sessionTitle}</strong></div>
          <button className="sn-dock-expand" type="button" onClick={() => navigation.showConversation()}>展开</button>
        </> : <>
          <div className="sn-conversation-actions">
            <button className="sn-sidebar-toggle" type="button" aria-label={sidebarOpen ? "收起会话导航" : "展开会话导航"} aria-expanded={sidebarOpen} onClick={() => layout.toggleSidebar()}>☰</button>
            <button className="sn-back-workbench" type="button" onClick={() => { layout.openAssistant(); navigation.showNexus(); }}><span>S</span><b>返回工作台</b></button>
          </div>
          <div className="sn-conversation-title"><small>SHADOW / CONVERSATION</small><strong>{current === undefined ? "选择工作区以开始" : sessionTitle}</strong></div>
          <label className="sn-session-select"><span>会话</span><select value={current ?? ""} onChange={(event) => {
            if (event.target.value === "") sessions.clear();
            else sessions.open(event.target.value as SessionId);
          }}><option value="">未选择</option>{sessionOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
        </>}
      </header>
      <div className="sn-conversation-columns" data-sidebar-open={sidebarOpen} data-details-open={detailsOpen}>
        <aside className="sn-native-sidebar" aria-hidden={!sidebarOpen}>{renderSlot("sidebar", { collapsed: !sidebarOpen, width: sidebarOpen ? 280 : 0 })}</aside>
        <main className="sn-native-conversation">{renderSlot("conversation", {})}</main>
        <aside className="sn-native-details" aria-hidden={!detailsOpen}>
          <SessionProvider empty={() => null}>{() => renderSlot("details", {})}</SessionProvider>
        </aside>
      </div>
    </section>
    <div className="sn-shell-overlay" data-shell-overlay>{renderSlot("shell.overlay", {})}</div>
  </div>;
}
