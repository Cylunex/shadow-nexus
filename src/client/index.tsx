import { type ClientContext, type ISessions, type SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type { PropsRenderSlots, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CaptureDraft, DomainId, DomainSummary, NexusBootstrap, NexusView, TodaySignal } from "../contracts.js";
import styles from "./nexus.css?inline";

export const name = "shadow-nexus";
export const inject = ["slots", "sessions"];

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "shadow-nexus.workspace": { kind: "single"; scope: "session" };
  }
}

const nav: readonly { id: NexusView; label: string; glyph: string }[] = [
  { id: "today", label: "今日", glyph: "◫" },
  { id: "capture", label: "记一下", glyph: "+" },
  { id: "review", label: "待确认", glyph: "◇" },
  { id: "health", label: "Health", glyph: "♡" },
  { id: "ledger", label: "Ledger", glyph: "⌁" },
  { id: "travel", label: "Travel", glyph: "⌖" },
  { id: "archive", label: "Archive", glyph: "▱" },
  { id: "foliant", label: "Foliant", glyph: "▤" }
];

const fallback: NexusBootstrap = {
  protocol: "shadow.nexus.v1",
  mode: "preview",
  generatedAt: new Date(0).toISOString(),
  greeting: "欢迎来到 Shadow Nexus。",
  dateLabel: "正在连接 DSH",
  focus: "工作台正在读取当前会话的领域投影。",
  signals: [],
  domains: [],
  drafts: []
};

function endpoint(path: string, sessionId: string): string {
  const url = new URL(`/shadow-nexus/${path}`, globalThis.location.origin);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { readonly error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`);
  return value;
}

function useBootstrap(sessionId: string) {
  const [data, setData] = useState<NexusBootstrap>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await json<NexusBootstrap>(await fetch(endpoint("bootstrap", sessionId), { cache: "no-store" })));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接 Shadow Nexus。");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}

function StatusDot({ status }: { readonly status: DomainSummary["status"] }) {
  return <span className="sn-status" data-status={status} title={status} />;
}

function DomainMark({ domain }: { readonly domain: DomainId }) {
  const marks: Record<DomainId, string> = { health: "H", ledger: "L", travel: "T", archive: "A", foliant: "F" };
  return <span className="sn-domain-mark" data-domain={domain}>{marks[domain]}</span>;
}

function SignalCard({ signal }: { readonly signal: TodaySignal }) {
  return <article className="sn-signal" data-tone={signal.tone}>
    <div className="sn-signal-top"><DomainMark domain={signal.domain} /><span>{signal.eyebrow}</span><time>{signal.time}</time></div>
    <h3>{signal.title}</h3>
    <p>{signal.detail}</p>
  </article>;
}

function TodayView({ data, onNavigate }: { readonly data: NexusBootstrap; readonly onNavigate: (view: NexusView) => void }) {
  const pending = data.drafts.filter((draft) => draft.state === "pending").length;
  return <div className="sn-page sn-page-today">
    <header className="sn-hero">
      <div><span className="sn-kicker">SHADOW / TODAY</span><h1>{data.greeting}</h1><p>{data.focus}</p></div>
      <div className="sn-date"><strong>{data.dateLabel}</strong><span>{data.mode === "connected" ? "领域服务已连接" : "结构预览模式"}</span></div>
    </header>
    <section className="sn-command">
      <button type="button" onClick={() => onNavigate("capture")}><span>+</span><div><strong>记一下</strong><small>自然语言进入当前会话，由 Shadow 分拣</small></div><kbd>⌘ Enter</kbd></button>
      <button type="button" onClick={() => onNavigate("review")}><span>◇</span><div><strong>{pending} 项待确认</strong><small>确认后才交给领域应用完成写入</small></div><em>查看</em></button>
    </section>
    <section className="sn-section">
      <div className="sn-section-title"><div><span>今日脉络</span><h2>值得留意的变化</h2></div><small>{data.signals.length} 条聚合信号</small></div>
      <div className="sn-signal-grid">{data.signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
    </section>
    <section className="sn-section">
      <div className="sn-section-title"><div><span>领域状态</span><h2>你的长期数据仍各归其位</h2></div></div>
      <div className="sn-domain-grid">{data.domains.map((domain) => <button type="button" key={domain.id} onClick={() => onNavigate(domain.id)}>
        <div className="sn-domain-heading"><DomainMark domain={domain.id} /><div><strong>{domain.label}</strong><span>{domain.caption}</span></div><StatusDot status={domain.status} /></div>
        <b>{domain.metric}</b><p>{domain.detail}</p>
      </button>)}</div>
    </section>
  </div>;
}

function CaptureView({ sessionId, onCreated, recordInSession }: {
  readonly sessionId: string;
  readonly onCreated: () => void;
  readonly recordInSession: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const suggestions = ["今天跑了 5 公里，感觉不错", "午餐花了 48 元", "收藏这段资料，晚点整理", "周末想去绍兴走走"];

  async function submit() {
    if (text.trim() === "") return;
    setBusy(true);
    try {
      await recordInSession(text.trim());
      await json<CaptureDraft>(await fetch(endpoint("capture", sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, text })
      }));
      setText("");
      setError(undefined);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "记录失败。");
    } finally {
      setBusy(false);
    }
  }

  return <div className="sn-page sn-capture-page">
    <header className="sn-page-header"><span>CAPTURE</span><h1>先记下来，归属可以稍后决定。</h1><p>Shadow 会把原文保留在当前 DSH 会话，并生成结构化草稿供你确认。</p></header>
    <section className="sn-capture-box">
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="刚刚发生了什么？也可以是一笔消费、一个地点、一段想法……" autoFocus />
      <div><small>{text.length}/4000 · 原文不会被改写</small><button type="button" disabled={busy || text.trim() === ""} onClick={() => { void submit(); }}>{busy ? "分拣中…" : "生成草稿"}</button></div>
      {error !== undefined && <p className="sn-error">{error}</p>}
    </section>
    <section className="sn-suggestions"><span>可以这样开始</span>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setText(suggestion)}>{suggestion}</button>)}</section>
    <aside className="sn-boundary"><b>一次录入，两段确认</b><p>会话负责保留上下文，Nexus 负责分拣和审核；Health、Ledger、Travel 等领域应用保留最终写入权。</p></aside>
  </div>;
}

function DraftCard({ draft, sessionId, onReviewed }: { readonly draft: CaptureDraft; readonly sessionId: string; readonly onReviewed: () => void }) {
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await json<CaptureDraft>(await fetch(endpoint("review", sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, draftId: draft.id, decision })
      }));
      onReviewed();
    } finally { setBusy(false); }
  }
  return <article className="sn-draft">
    <header><DomainMark domain={draft.domain} /><div><span>{draft.intent}</span><time>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><em data-risk={draft.risk}>{draft.risk === "low" ? "低风险" : draft.risk === "medium" ? "需确认" : "高风险"}</em></header>
    <h3>{draft.summary}</h3>
    <dl>{Object.entries(draft.fields).filter(([key]) => key !== "original").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    <footer><button type="button" disabled={busy} onClick={() => { void decide("reject"); }}>退回</button><button className="sn-primary" type="button" disabled={busy} onClick={() => { void decide("approve"); }}>确认草稿</button></footer>
  </article>;
}

function ReviewView({ data, sessionId, reload }: { readonly data: NexusBootstrap; readonly sessionId: string; readonly reload: () => void }) {
  const pending = data.drafts.filter((draft) => draft.state === "pending");
  const settled = data.drafts.filter((draft) => draft.state !== "pending");
  return <div className="sn-page">
    <header className="sn-page-header"><span>REVIEW</span><h1>待确认，不等于已写入。</h1><p>这里展示 Shadow 的理解结果。首版确认动作仅产生预览回执，领域适配器接入后才会执行真实写入。</p></header>
    {pending.length === 0 ? <div className="sn-empty"><span>◇</span><h2>暂时没有待确认项</h2><p>从“记一下”开始，或者继续在右侧会话中告诉 Shadow。</p></div> : <div className="sn-draft-list">{pending.map((draft) => <DraftCard key={draft.id} draft={draft} sessionId={sessionId} onReviewed={reload} />)}</div>}
    {settled.length > 0 && <section className="sn-history"><h2>本次会话已处理</h2>{settled.map((draft) => <p key={draft.id}><DomainMark domain={draft.domain} /><span>{draft.summary}</span><em data-state={draft.state}>{draft.state === "approved" ? "已确认预览" : "已退回"}</em></p>)}</section>}
  </div>;
}

function DomainView({ domain }: { readonly domain: DomainSummary | undefined }) {
  if (domain === undefined) return <div className="sn-page"><div className="sn-empty"><h2>领域尚未接入</h2></div></div>;
  return <div className="sn-page sn-domain-page">
    <header className="sn-domain-hero"><DomainMark domain={domain.id} /><div><span>SHADOW DOMAIN</span><h1>{domain.label}</h1><p>{domain.caption}</p></div><StatusDot status={domain.status} /></header>
    <section className="sn-domain-feature"><span>当前摘要</span><strong>{domain.metric}</strong><p>{domain.detail}</p></section>
    <div className="sn-domain-columns"><section><span>事实边界</span><h2>数据留在 {domain.label}</h2><p>Nexus 只读取允许暴露的摘要、待办和跨域引用，不复制领域事实表。</p></section><section><span>会话协作</span><h2>让 Shadow 继续处理</h2><p>在右侧官方会话中提问、补充上下文或发起工作流，结果仍回到审核链。</p></section></div>
    {domain.status === "offline" && <aside className="sn-boundary"><b>保留入口</b><p>该项目仍在改造中，Nexus 不读取临时接口，也不为追求“有数据”而建立兼容层。</p></aside>}
  </div>;
}

interface NexusInjected {
  readonly sessions: ISessions;
}

type WorkspaceProps = PropsRuntime<"shadow-nexus.workspace"> & NexusInjected;

function NexusWorkspace({ sessionId, sessions }: WorkspaceProps) {
  const { data, loading, error, reload } = useBootstrap(sessionId);
  const [view, setView] = useState<NexusView>("today");
  const currentDomain = useMemo(() => data.domains.find((domain) => domain.id === view), [data.domains, view]);

  const onCreated = useCallback(() => { void reload(); setView("review"); }, [reload]);
  const recordInSession = useCallback(async (text: string) => {
    const scope = sessions.scope(sessionId as SessionId);
    const face = scope === undefined ? undefined : sessions.sessionOf(scope);
    if (face === undefined) throw new Error("当前 DSH 会话尚未就绪。");
    const prompt = `[Shadow Nexus · Capture]\n请保留下面的原始信息并帮助理解；在用户于 Review 确认前，不要调用任何领域写入工具。\n\n${text}`;
    const accepted = await face.prompt([{ type: "text", text: prompt }], "queue");
    if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
  }, [sessionId, sessions]);
  return <div className="sn-app">
    <aside className="sn-sidebar">
      <div className="sn-brand"><span>S</span><div><strong>SHADOW</strong><small>NEXUS</small></div></div>
      <nav>{nav.map((item, index) => <button type="button" key={item.id} data-active={view === item.id} onClick={() => setView(item.id)}><i>{item.glyph}</i><span>{item.label}</span>{item.id === "review" && data.drafts.some((draft) => draft.state === "pending") ? <b>{data.drafts.filter((draft) => draft.state === "pending").length}</b> : null}{index === 2 ? <em /> : null}</button>)}</nav>
      <footer><span className="sn-orbit"><i /></span><div><strong>Shadow</strong><small>{loading ? "同步中" : error === undefined ? "DSH 会话已连接" : "连接异常"}</small></div></footer>
    </aside>
    <main className="sn-main">
      {error !== undefined && <div className="sn-alert"><span>!</span><p>{error}</p><button type="button" onClick={() => { void reload(); }}>重试</button></div>}
      {view === "today" && <TodayView data={data} onNavigate={setView} />}
      {view === "capture" && <CaptureView sessionId={sessionId} onCreated={onCreated} recordInSession={recordInSession} />}
      {view === "review" && <ReviewView data={data} sessionId={sessionId} reload={() => { void reload(); }} />}
      {view !== "today" && view !== "capture" && view !== "review" && <DomainView domain={currentDomain} />}
    </main>
  </div>;
}

type SeatProps = PropsRuntime<"shell.overlay"> & PropsRenderSlots<"shadow-nexus.workspace">;

function NexusSeat({ SessionProvider, renderSlot }: SeatProps) {
  return <SessionProvider>{() => renderSlot("shadow-nexus.workspace", {})}</SessionProvider>;
}

function NexusBridge(props: WorkspaceProps) {
  const marker = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<HTMLElement>();
  useLayoutEffect(() => {
    const document = marker.current?.ownerDocument;
    if (document === undefined) return;
    const locate = (): void => {
      const scroll = document.querySelector<HTMLElement>("[data-conversation-scroll]");
      setTarget((current) => current === scroll ? current : scroll ?? undefined);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }, [props.sessionId]);
  return <><span ref={marker} className="sn-bridge-marker" />{target !== undefined && createPortal(<NexusWorkspace {...props} />, target)}</>;
}

function ensureStyles(): void {
  if (document.querySelector("style[data-shadow-nexus]") !== null) return;
  const element = document.createElement("style");
  element.dataset.shadowNexus = "true";
  element.textContent = styles;
  document.head.append(element);
}

export function apply(context: ClientContext): void {
  ensureStyles();
  const sessions = context.get("sessions") as unknown as ISessions;
  context.slots.inject("shell.overlay", () => {
    const seat = context.slots.register({
      name: "shell.overlay",
      id: "shadow-nexus-workspace",
      order: -120,
      children: { "shadow-nexus.workspace": { kind: "single", scope: "session" } }
    }, NexusSeat);
    const workspace = context.slots.register({
      name: "shadow-nexus.workspace",
      inject: (): NexusInjected => ({ sessions })
    }, NexusBridge);
    return [seat, workspace];
  });
}

export default { name, inject, apply };
