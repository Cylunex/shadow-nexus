import { type ISessions, type SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CaptureDraft, NexusAssetAttachment, NexusBootstrap, NexusInteractionResult } from "../contracts.js";
import { askNexus, type InteractionPhase, submitNexus, uploadNexusAsset } from "./assistant.js";
import { useNexusBootstrap } from "./api.js";
import type { NexusAskContext, NexusModuleContext, NexusModuleGroup, NexusModuleRegistry } from "./contracts.js";
import type { NexusLayoutState } from "./layout-state.js";
import { NexusModuleBoundary } from "./module-boundary.js";
import type { NexusNavigationStore } from "./navigation.js";
import { DraftCard } from "./pages.js";

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
  readonly contextLabel: string;
  readonly assetUploadEnabled: boolean;
  readonly maxFiles: number;
  readonly domains: NexusBootstrap["domains"];
  readonly reload: () => Promise<void>;
  readonly submitInteraction: (text: string, attachments: readonly NexusAssetAttachment[], onPhase: (phase: InteractionPhase) => void) => Promise<NexusInteractionResult>;
}

interface DraftAttachment {
  readonly key: string;
  readonly file: File;
  readonly previewUrl: string | undefined;
  readonly uploaded?: NexusAssetAttachment;
}

function draftAttachment(file: File): DraftAttachment {
  return {
    key: globalThis.crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
  };
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_COMPOSER_HEIGHT = 88;
const MIN_COMPOSER_HEIGHT = 42;
const COMPOSER_HEIGHT_KEY = "shadow-nexus:composer-height";

function clampComposerHeight(value: number): number {
  const viewportLimit = typeof window === "undefined" ? 520 : Math.max(MIN_COMPOSER_HEIGHT, Math.min(520, window.innerHeight * .55));
  return Math.round(Math.min(viewportLimit, Math.max(MIN_COMPOSER_HEIGHT, value)));
}

function savedComposerHeight(): number {
  if (typeof window === "undefined") return DEFAULT_COMPOSER_HEIGHT;
  const value = Number(window.localStorage.getItem(COMPOSER_HEIGHT_KEY));
  return Number.isFinite(value) && value > 0 ? clampComposerHeight(value) : DEFAULT_COMPOSER_HEIGHT;
}

function phaseLabel(phase: "uploading" | InteractionPhase | undefined): string {
  if (phase === "uploading") return "正在保存附件…";
  if (phase === "analyzing") return "Shadow 正在理解并读取所需上下文…";
  if (phase === "preparing") return "正在核对已有 Proposal，避免重复…";
  if (phase === "ready") return "处理完成";
  return "发送";
}

function AssistantBar({ sessionId, sessionTitle, contextLabel, assetUploadEnabled, maxFiles, domains, reload, submitInteraction }: AssistantBarProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<readonly DraftAttachment[]>([]);
  const [composerHeight, setComposerHeight] = useState(savedComposerHeight);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"uploading" | InteractionPhase>();
  const [result, setResult] = useState<NexusInteractionResult>();
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentSnapshot = useRef(attachments);
  const resizeSnapshot = useRef<{ readonly pointerId: number; readonly startY: number; readonly startHeight: number }>();
  attachmentSnapshot.current = attachments;

  const releaseAttachments = useCallback((items: readonly DraftAttachment[]) => {
    for (const item of items) if (item.previewUrl !== undefined) URL.revokeObjectURL(item.previewUrl);
  }, []);

  useEffect(() => () => { releaseAttachments(attachmentSnapshot.current); }, [releaseAttachments]);
  useEffect(() => {
    window.localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);
  useEffect(() => {
    releaseAttachments(attachmentSnapshot.current);
    setAttachments([]);
    setResult(undefined);
    setPhase(undefined);
    setError(undefined);
  }, [releaseAttachments, sessionId]);

  function addFiles(files: readonly File[]) {
    if (!assetUploadEnabled) {
      setError("Shadow Asset 尚未连接，暂时不能上传附件。");
      return;
    }
    const nonEmpty = files.filter((file) => file.size > 0);
    if (nonEmpty.length !== files.length) {
      setError("不能上传空文件。");
      return;
    }
    if (attachments.length + nonEmpty.length > maxFiles) {
      setError(`每条消息最多附带 ${String(maxFiles)} 个文件。`);
      return;
    }
    setAttachments((current) => [...current, ...nonEmpty.map(draftAttachment)]);
    setError(undefined);
  }

  function removeAttachment(key: string) {
    setAttachments((current) => {
      const removed = current.find((item) => item.key === key);
      if (removed?.previewUrl !== undefined) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  async function submit() {
    if (sessionId === undefined || (text.trim() === "" && attachments.length === 0)) return;
    setBusy(true);
    setResult(undefined);
    try {
      const resolved = [...attachments];
      for (let index = 0; index < resolved.length; index += 1) {
        const item = resolved[index];
        if (item === undefined || item.uploaded !== undefined) continue;
        setPhase("uploading");
        const uploaded = await uploadNexusAsset(sessionId, item.file);
        resolved[index] = { ...item, uploaded };
        setAttachments([...resolved]);
      }
      const uploaded = resolved.flatMap((item) => item.uploaded === undefined ? [] : [item.uploaded]);
      const next = await submitInteraction(text, uploaded, setPhase);
      setResult(next);
      releaseAttachments(resolved);
      setAttachments([]);
      setText("");
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败。");
    } finally {
      setBusy(false);
      setPhase(undefined);
    }
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeSnapshot.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: composerHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeSnapshot.current;
    if (resize?.pointerId !== event.pointerId) return;
    setComposerHeight(clampComposerHeight(resize.startHeight + resize.startY - event.clientY));
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeSnapshot.current?.pointerId !== event.pointerId) return;
    resizeSnapshot.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function updateDraft(updated: CaptureDraft) {
    setResult((current) => current === undefined ? current : {
      ...current,
      drafts: current.drafts.map((draft) => draft.id === updated.id ? updated : draft)
    });
  }

  return <section className="sn-assistant-bar" onDragOver={(event) => {
    if (sessionId !== undefined && !busy && assetUploadEnabled && event.dataTransfer.types.includes("Files")) event.preventDefault();
  }} onDrop={(event) => {
    if (sessionId === undefined || busy || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  }}>
    {result !== undefined && <section className="sn-inline-result">
      <header><div><span>{result.drafts.length === 0 ? "SHADOW" : `识别到 ${String(result.drafts.length)} 项`}</span><strong>{result.plan.route === "clarify" ? "需要补充信息" : result.drafts.length === 0 ? "已回复" : "写入前请确认"}</strong></div><button type="button" aria-label="收起本次结果" onClick={() => setResult(undefined)}>×</button></header>
      {result.plan.response.trim() !== "" && <p>{result.plan.response}</p>}
      {result.drafts.length > 0 && <div className="sn-inline-proposals">{result.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} sourceTitle={draft.origin === "domain" ? "已关联领域草稿" : "当前输入"} target={domains.find((domain) => domain.id === draft.domain)} siblingCount={result.drafts.length} reload={reload} compact onUpdated={updateDraft} />)}</div>}
    </section>}
    <button className="sn-assistant-resize" type="button" aria-label="拖动调整输入区高度" title="向上拖动放大输入区；双击恢复默认高度" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onDoubleClick={() => setComposerHeight(DEFAULT_COMPOSER_HEIGHT)} onKeyDown={(event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        setComposerHeight((current) => clampComposerHeight(current + (event.key === "ArrowUp" ? 16 : -16)));
      } else if (event.key === "Home") {
        event.preventDefault();
        setComposerHeight(DEFAULT_COMPOSER_HEIGHT);
      }
    }}><span /></button>
    <div className="sn-assistant-tools">
      <div className="sn-assistant-context"><span>当前上下文</span><strong><b>{contextLabel}</b>{sessionTitle ?? "未选择"}</strong></div>
      <button className="sn-assistant-attach" type="button" aria-label="上传图片或文件" title={assetUploadEnabled ? "上传到 Shadow Asset 并附带到当前对话" : "Shadow Asset 尚未连接"} disabled={sessionId === undefined || busy || !assetUploadEnabled} onClick={() => fileInput.current?.click()}>＋</button>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => {
        addFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }} />
    </div>
    <textarea rows={3} style={{ height: composerHeight }} maxLength={4000} value={text} disabled={sessionId === undefined || busy} placeholder={sessionId === undefined ? "先打开一个对话上下文" : "告诉 Shadow 任何事……聊天、记录和附件都从这里开始"} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
      }
    }} onPaste={(event) => {
      const files = [...event.clipboardData.files];
      if (files.length > 0) {
        event.preventDefault();
        addFiles(files);
      }
    }} />
    <button className="sn-assistant-send" type="button" disabled={sessionId === undefined || busy || (text.trim() === "" && attachments.length === 0)} onClick={() => { void submit(); }}>{busy ? phaseLabel(phase) : "发送"}</button>
    {attachments.length > 0 && <div className="sn-assistant-attachments">
      {attachments.map((attachment) => <article key={attachment.key} data-uploaded={attachment.uploaded !== undefined}>
        {attachment.previewUrl === undefined ? <span>FILE</span> : <img src={attachment.previewUrl} alt="" />}
        <p><strong>{attachment.file.name || "asset"}</strong><small>{attachment.uploaded === undefined ? sizeLabel(attachment.file.size) : "已存入 Asset"}</small></p>
        <button type="button" aria-label={`移除 ${attachment.file.name || "附件"}`} disabled={busy} onClick={() => removeAttachment(attachment.key)}>×</button>
      </article>)}
    </div>}
    <small>Shadow 先理解再行动；任何 Health/Ledger 写入都会原地展示 Proposal。用 /ask 强制只聊，用 /record 强制记录。</small>
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
  const ask = useCallback(async (text: string, askContext?: NexusAskContext, attachments: readonly NexusAssetAttachment[] = []) => {
    if (sessionId === undefined) throw new Error("请先选择一个工作台会话。");
    await askNexus(sessions, sessionId, text, askContext ?? { module: active?.route ?? "today" }, attachments);
    layout.openAssistant();
  }, [active?.route, layout, sessionId, sessions]);
  const submitInteraction = useCallback(async (text: string, attachments: readonly NexusAssetAttachment[], onPhase: (phase: InteractionPhase) => void) => {
    if (sessionId === undefined) throw new Error("请先选择一个工作台会话。");
    const result = await submitNexus(sessions, sessionId, text, attachments, onPhase, { module: active?.route ?? "today" });
    if (result.drafts.length > 0) await reload();
    return result;
  }, [active?.route, reload, sessionId, sessions]);
  const recentSessions = sessionOptions.map((session) => ({ ...session, current: session.id === sessionId }));
  const continueSession = useCallback((targetSessionId: string) => {
    sessions.open(targetSessionId as SessionId);
    layout.openAssistant();
  }, [layout, sessions]);
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
        <div><span className="sn-orbit"><i /></span><p><small>当前上下文</small><strong>{sessionTitle ?? "尚未开始一件事"}</strong></p></div>
        <details className="sn-session-details"><summary>上下文详情</summary><label><span>DSH Session</span><select value={sessionId ?? ""} onChange={(event) => {
          if (event.target.value === "") sessions.clear();
          else sessions.open(event.target.value as SessionId);
        }}><option value="">未选择</option>{sessionOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label></details>
        <button type="button" onClick={showConversation}>{sessionId === undefined ? "打开对话" : "展开对话"}</button>
      </header>
      {error !== undefined && <div className="sn-alert"><span>!</span><p>{error}</p><button type="button" onClick={() => { void reload(); }}>重试</button></div>}
      {Page === undefined || activeId === undefined
        ? <div className="sn-page"><div className="sn-empty"><h2>没有可用模块</h2></div></div>
        : <NexusModuleBoundary key={activeId} moduleId={activeId}>
          <Page sessionId={sessionId} sessions={sessions} data={data} loading={loading} error={error} reload={reload} navigate={navigate} showConversation={showConversation} ask={ask} recentSessions={recentSessions} continueSession={continueSession} />
        </NexusModuleBoundary>}
    </main>
    <AssistantBar sessionId={sessionId} sessionTitle={sessionTitle} contextLabel={active?.title ?? "现在"} assetUploadEnabled={data.assetUpload.enabled} maxFiles={data.assetUpload.maxFilesPerMessage} domains={data.domains} reload={reload} submitInteraction={submitInteraction} />
  </div>;
}
