import type { SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { useCallback, useState } from "react";
import type { CaptureDraft, DomainId, DomainSummary, TodaySignal } from "../contracts.js";
import { nexusEndpoint, nexusJson } from "./api.js";
import type { NexusModuleDescriptor, NexusPageProps } from "./contracts.js";

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

export function TodayPage({ data, navigate }: NexusPageProps) {
  const pending = data.drafts.filter((draft) => draft.state === "pending").length;
  return <div className="sn-page sn-page-today">
    <header className="sn-hero">
      <div><span className="sn-kicker">SHADOW / TODAY</span><h1>{data.greeting}</h1><p>{data.focus}</p></div>
      <div className="sn-date"><strong>{data.dateLabel}</strong><span>{data.mode === "connected" ? "领域服务已连接" : "结构预览模式"}</span></div>
    </header>
    <section className="sn-command">
      <button type="button" onClick={() => navigate("capture")}><span>+</span><div><strong>记一下</strong><small>自然语言进入当前会话，由 Shadow 分拣</small></div><kbd>⌘ Enter</kbd></button>
      <button type="button" onClick={() => navigate("review")}><span>◇</span><div><strong>{pending} 项待确认</strong><small>确认后才交给领域应用创建草稿</small></div><em>查看</em></button>
    </section>
    <section className="sn-section">
      <div className="sn-section-title"><div><span>今日脉络</span><h2>值得留意的变化</h2></div><small>{data.signals.length} 条聚合信号</small></div>
      {data.signals.length === 0
        ? <div className="sn-empty sn-empty-compact"><span>·</span><h2>暂时没有聚合信号</h2><p>领域服务连接后，今日摘要会在这里出现。</p></div>
        : <div className="sn-signal-grid">{data.signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>}
    </section>
    <section className="sn-section">
      <div className="sn-section-title"><div><span>领域状态</span><h2>你的长期数据仍各归其位</h2></div></div>
      <div className="sn-domain-grid">{data.domains.map((domain) => <button type="button" key={domain.id} onClick={() => navigate(domain.id)}>
        <div className="sn-domain-heading"><DomainMark domain={domain.id} /><div><strong>{domain.label}</strong><span>{domain.caption}</span></div><StatusDot status={domain.status} /></div>
        <b>{domain.metric}</b><p>{domain.detail}</p>
      </button>)}</div>
    </section>
  </div>;
}

export function CapturePage({ sessionId, sessions, navigate, reload, showConversation }: NexusPageProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const suggestions = ["今天跑了 5 公里，感觉不错", "午餐花了 48 元", "收藏这段资料，晚点整理", "周末想去绍兴走走"];

  const submit = useCallback(async () => {
    if (text.trim() === "" || sessionId === undefined) return;
    setBusy(true);
    try {
      const scope = sessions.scope(sessionId as SessionId);
      const face = scope === undefined ? undefined : sessions.sessionOf(scope);
      if (face === undefined) throw new Error("当前 DSH 会话尚未就绪。");
      const original = text.trim();
      const prompt = `[Shadow Nexus · Capture]\n请保留下面的原始信息并帮助理解；在用户于 Review 确认前，不要调用任何领域写入工具。\n\n${original}`;
      const accepted = await face.prompt([{ type: "text", text: prompt }], "queue");
      if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
      await nexusJson<CaptureDraft>(await fetch(nexusEndpoint("capture", sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, text: original })
      }));
      setText("");
      setError(undefined);
      await reload();
      navigate("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "记录失败。");
    } finally {
      setBusy(false);
    }
  }, [navigate, reload, sessionId, sessions, text]);

  return <div className="sn-page sn-capture-page">
    <header className="sn-page-header"><span>CAPTURE</span><h1>先记下来，归属可以稍后决定。</h1><p>Shadow 会把原文保留在当前 DSH 会话，并生成结构化草稿供你确认。</p></header>
    {sessionId === undefined
      ? <div className="sn-empty"><span>◇</span><h2>需要一个 DSH 会话</h2><p>打开对话并选择工作区，随后即可回到这里快速记录。</p><button className="sn-primary" type="button" onClick={showConversation}>打开对话</button></div>
      : <>
        <section className="sn-capture-box">
          <textarea value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder="刚刚发生了什么？也可以是一笔消费、一个地点、一段想法……" autoFocus />
          <div><small>{text.length}/4000 · 原文不会被改写</small><button type="button" disabled={busy || text.trim() === ""} onClick={() => { void submit(); }}>{busy ? "分拣中…" : "生成草稿"}</button></div>
          {error !== undefined && <p className="sn-error">{error}</p>}
        </section>
        <section className="sn-suggestions"><span>可以这样开始</span>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setText(suggestion)}>{suggestion}</button>)}</section>
        <aside className="sn-boundary"><b>一次录入，两段确认</b><p>会话负责保留上下文，Nexus 负责分拣和审核；各领域应用保留最终写入权。</p></aside>
      </>}
  </div>;
}

function DraftCard({ draft, sessionId, reload }: { readonly draft: CaptureDraft; readonly sessionId: string; readonly reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await nexusJson<CaptureDraft>(await fetch(nexusEndpoint("review", sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, draftId: draft.id, decision })
      }));
      setError(undefined);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理草稿失败。");
    } finally { setBusy(false); }
  }
  return <article className="sn-draft">
    <header><DomainMark domain={draft.domain} /><div><span>{draft.intent}</span><time>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><em data-risk={draft.risk}>{draft.risk === "low" ? "低风险" : draft.risk === "medium" ? "需确认" : "高风险"}</em></header>
    <h3>{draft.summary}</h3>
    <dl>{Object.entries(draft.fields).filter(([key]) => key !== "original").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={() => { void decide("reject"); }}>退回</button><button className="sn-primary" type="button" disabled={busy} onClick={() => { void decide("approve"); }}>确认草稿</button></footer>
  </article>;
}

export function ReviewPage({ data, sessionId, reload, showConversation }: NexusPageProps) {
  if (sessionId === undefined) return <div className="sn-page"><header className="sn-page-header"><span>REVIEW</span><h1>待确认，不等于已写入。</h1></header><div className="sn-empty"><span>◇</span><h2>尚未选择会话</h2><p>待确认队列按 DSH Session 隔离。</p><button className="sn-primary" type="button" onClick={showConversation}>打开对话</button></div></div>;
  const pending = data.drafts.filter((draft) => draft.state === "pending");
  const settled = data.drafts.filter((draft) => draft.state !== "pending");
  return <div className="sn-page">
    <header className="sn-page-header"><span>REVIEW</span><h1>待确认，不等于已写入。</h1><p>确认后只在已接入领域创建可撤销草稿，最终事实仍由领域应用负责。</p></header>
    {pending.length === 0 ? <div className="sn-empty"><span>◇</span><h2>暂时没有待确认项</h2><p>从“记一下”开始，或者切换到对话继续告诉 Shadow。</p></div> : <div className="sn-draft-list">{pending.map((draft) => <DraftCard key={draft.id} draft={draft} sessionId={sessionId} reload={reload} />)}</div>}
    {settled.length > 0 && <section className="sn-history"><h2>本次会话已处理</h2>{settled.map((draft) => <p key={draft.id}><DomainMark domain={draft.domain} /><span>{draft.summary}</span><em data-state={draft.state}>{draft.state === "approved" ? "领域草稿已创建" : "已退回"}</em></p>)}</section>}
  </div>;
}

function DomainPage({ data, showConversation, domainId }: NexusPageProps & { readonly domainId: DomainId }) {
  const domain = data.domains.find((item) => item.id === domainId);
  if (domain === undefined) return <div className="sn-page"><div className="sn-empty"><h2>领域尚未接入</h2></div></div>;
  return <div className="sn-page sn-domain-page">
    <header className="sn-domain-hero"><DomainMark domain={domain.id} /><div><span>SHADOW DOMAIN</span><h1>{domain.label}</h1><p>{domain.caption}</p></div><StatusDot status={domain.status} /></header>
    <section className="sn-domain-feature"><span>当前摘要</span><strong>{domain.metric}</strong><p>{domain.detail}</p></section>
    <div className="sn-domain-columns"><section><span>事实边界</span><h2>数据留在 {domain.label}</h2><p>Nexus 只读取允许暴露的摘要、待办和跨域引用，不复制领域事实表。</p></section><section><span>会话协作</span><h2>让 Shadow 继续处理</h2><p>复杂任务切换到完整 Conversation；结果仍回到同一个 Session 和审核链。</p><button type="button" onClick={showConversation}>进入对话</button></section></div>
    {domain.status === "offline" && <aside className="sn-boundary"><b>保留入口</b><p>该领域仍在改造中，Nexus 不读取临时接口，也不建立不受支持的兼容层。</p></aside>}
  </div>;
}

function HealthPage(props: NexusPageProps) { return <DomainPage {...props} domainId="health" />; }
function LedgerPage(props: NexusPageProps) { return <DomainPage {...props} domainId="ledger" />; }
function TravelPage(props: NexusPageProps) { return <DomainPage {...props} domainId="travel" />; }
function ArchivePage(props: NexusPageProps) { return <DomainPage {...props} domainId="archive" />; }
function FoliantPage(props: NexusPageProps) { return <DomainPage {...props} domainId="foliant" />; }

export function builtinNexusModules(): readonly NexusModuleDescriptor[] {
  return [
    { id: "nexus:today", apiVersion: 1, title: "今日", route: "today", icon: "◫", group: "home", order: 0, scope: "root", page: TodayPage },
    { id: "nexus:capture", apiVersion: 1, title: "记一下", route: "capture", icon: "+", group: "home", order: 10, scope: "root", page: CapturePage },
    { id: "nexus:review", apiVersion: 1, title: "待确认", route: "review", icon: "◇", group: "home", order: 20, scope: "root", page: ReviewPage, badge: ({ data }) => data.drafts.filter((draft) => draft.state === "pending").length || undefined },
    { id: "shadow:health", apiVersion: 1, title: "Health", route: "health", icon: "♡", group: "domains", order: 0, scope: "root", page: HealthPage },
    { id: "shadow:ledger", apiVersion: 1, title: "Ledger", route: "ledger", icon: "⌁", group: "domains", order: 10, scope: "root", page: LedgerPage },
    { id: "shadow:travel", apiVersion: 1, title: "Travel", route: "travel", icon: "⌖", group: "domains", order: 20, scope: "root", page: TravelPage },
    { id: "shadow:archive", apiVersion: 1, title: "Archive", route: "archive", icon: "▱", group: "domains", order: 30, scope: "root", page: ArchivePage },
    { id: "shadow:foliant", apiVersion: 1, title: "Foliant", route: "foliant", icon: "▤", group: "domains", order: 40, scope: "root", page: FoliantPage }
  ];
}
