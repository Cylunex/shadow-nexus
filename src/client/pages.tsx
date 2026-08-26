import type { SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { useState } from "react";
import type { CaptureDraft, DomainId, DomainSummary, NexusSearchResult, TodaySignal } from "../contracts.js";
import { nexusEndpoint, nexusJson } from "./api.js";
import type { NexusModuleDescriptor, NexusPageProps } from "./contracts.js";

function StatusDot({ status }: { readonly status: DomainSummary["status"] }) {
  return <span className="sn-status" data-status={status} title={status} />;
}

function DomainMark({ domain }: { readonly domain: DomainId }) {
  return <span className="sn-domain-mark" data-domain={domain}>{domain.slice(0, 1).toLocaleUpperCase()}</span>;
}

function fieldLabel(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2").replaceAll("_", " ");
}

function displayFieldValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null) return JSON.stringify(parsed, null, 2);
  } catch { /* Plain text is already the correct representation. */ }
  return value;
}

function SignalCard({ signal }: { readonly signal: TodaySignal }) {
  return <article className="sn-signal" data-tone={signal.tone}>
    <div className="sn-signal-top"><DomainMark domain={signal.domain} /><span>{signal.eyebrow}</span><time>{signal.time}</time></div>
    <h3>{signal.title}</h3>
    <p>{signal.detail}</p>
  </article>;
}

export function TodayPage({ data, navigate, recentSessions = [], continueSession }: NexusPageProps) {
  const pending = data.drafts.filter((draft) => draft.state === "pending").length;
  return <div className="sn-page sn-page-today">
    <header className="sn-hero">
      <div><span className="sn-kicker">SHADOW / NOW</span><h1>{data.greeting}</h1><p>继续一件事，或者直接在下方告诉 Shadow 任何内容。</p></div>
      <div className="sn-date"><strong>{data.dateLabel}</strong><span>{data.mode === "connected" ? "领域服务已连接" : "结构预览模式"}</span></div>
    </header>
    <section className="sn-command">
      <button type="button" onClick={() => document.querySelector<HTMLTextAreaElement>(".sn-assistant-bar textarea")?.focus()}><span>＋</span><div><strong>告诉 Shadow</strong><small>聊天、记录、分析和附件使用同一个入口</small></div><kbd>⌘ Enter</kbd></button>
      <button type="button" onClick={() => navigate("review")}><span>◇</span><div><strong>{pending} 项待我处理</strong><small>只把真正需要决定的 Proposal 带回来</small></div><em>查看</em></button>
    </section>
    {recentSessions.length > 0 && <section className="sn-section sn-continue-section">
      <div className="sn-section-title"><div><span>继续</span><h2>回到最近的上下文</h2></div><small>DSH Session 只作为底层容器</small></div>
      <div className="sn-continue-list">{recentSessions.slice(0, 4).map((session) => <button type="button" key={session.id} data-current={session.current} onClick={() => continueSession?.(session.id)}><span>{session.current ? "当前" : "最近"}</span><strong>{session.title}</strong><em>继续对话</em></button>)}</div>
    </section>}
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

export function DraftCard({ draft, sourceTitle, target, siblingCount, reload, compact = false, onUpdated }: {
  readonly draft: CaptureDraft;
  readonly sourceTitle: string;
  readonly target: DomainSummary | undefined;
  readonly siblingCount: number;
  readonly reload: () => Promise<void>;
  readonly compact?: boolean;
  readonly onUpdated?: (draft: CaptureDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const connectedTarget = target?.status === "ready" && target.captureEnabled && draft.confirmable !== false;
  const targetLabel = target?.label ?? draft.domain;
  const visibleFields = Object.entries(draft.fields).filter(([key]) => key !== "source" && key !== "original");
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      const updated = await nexusJson<CaptureDraft>(await fetch(nexusEndpoint("review", draft.sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: draft.sessionId, draftId: draft.id, decision })
      }));
      setError(undefined);
      onUpdated?.(updated);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理草稿失败。");
    } finally { setBusy(false); }
  }
  if (draft.state !== "pending") return <article className="sn-draft sn-draft-result" data-state={draft.state}>
    <header><DomainMark domain={draft.domain} /><div><span>{draft.state === "approved" ? "已完成" : "已退回"}</span><time>{draft.summary}</time></div><em>{draft.state === "approved" ? "✓" : "—"}</em></header>
    {draft.receipt !== undefined && <p>Receipt · {draft.receipt}</p>}
  </article>;
  return <article className="sn-draft" data-compact={compact}>
    <header><DomainMark domain={draft.domain} /><div><span>{draft.intent}</span><time>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 来源：{sourceTitle}</time></div><em data-risk={draft.risk}>{draft.risk === "low" ? "低风险" : draft.risk === "medium" ? "需确认" : "高风险"}</em></header>
    <h3>{draft.summary}</h3>
    <div className="sn-draft-target" data-ready={connectedTarget}>
      <DomainMark domain={draft.domain} />
      <p><strong>{connectedTarget ? `将提交到 ${targetLabel}` : `${targetLabel} 暂不可提交`}</strong><span>{connectedTarget ? draft.origin === "domain" ? `已关联 ${targetLabel} 现有 Proposal；确认时提交同一对象，不会重复创建。` : draft.match === "existing" ? "已找到相同 Proposal，不会重复创建或写入。" : target?.reviewRisk === "high" ? "这是高影响操作；确认后由 Nexus 生成短时签名回执再执行。" : `确认后按 ${targetLabel} 声明的审核协议执行，并返回领域凭证。` : "领域连接、采集入口或确认状态当前不可用。"}</span></p>
    </div>
    {siblingCount > 1 && <p className="sn-draft-group">同一次记录已拆成 {siblingCount} 张领域草稿，请分别核对和确认。</p>}
    <section className="sn-draft-fields"><h4>将提交的字段</h4><dl>{visibleFields.map(([key, value]) => <div key={key} data-field={key}><dt>{fieldLabel(key)}</dt><dd>{displayFieldValue(value)}</dd></div>)}</dl></section>
    {!compact && <details className="sn-draft-source"><summary>查看完整原文 <span>{draft.text.length} 字 · 可拖动右下角放大</span></summary><pre>{draft.text}</pre></details>}
    {error !== undefined && <p className="sn-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={() => { void decide("reject"); }}>退回</button><button className="sn-primary" type="button" disabled={busy || !connectedTarget} title={connectedTarget ? undefined : "目标领域尚未连接或未声明采集入口"} onClick={() => { void decide("approve"); }}>{connectedTarget ? target?.reviewRisk === "high" ? `明确确认并执行 ${targetLabel}` : `确认并提交 ${targetLabel}` : "暂不可提交"}</button></footer>
  </article>;
}

function DraftGroup({ drafts, sourceTitle, domains, reload }: {
  readonly drafts: readonly CaptureDraft[];
  readonly sourceTitle: (draft: CaptureDraft) => string;
  readonly domains: readonly DomainSummary[];
  readonly reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const groupId = drafts[0]?.captureGroupId;
  const confirmable = drafts.every((draft) => {
    const domain = domains.find((item) => item.id === draft.domain);
    return domain?.status === "ready" && domain.captureEnabled && draft.confirmable !== false;
  });
  const title = drafts.every((draft) => draft.origin === "domain")
    ? `${domains.find((domain) => domain.id === drafts[0]?.domain)?.label ?? "领域"} Agent 待审核`
    : "同次采集 Proposal";

  async function decideAll(decision: "approve" | "reject") {
    if (groupId === undefined) return;
    setBusy(true);
    try {
      await nexusJson<readonly CaptureDraft[]>(await fetch(nexusEndpoint("review/batch"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ captureGroupId: groupId, decision })
      }));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量处理草稿失败；已完成的项目会保留结果。");
    } finally {
      await reload();
      setBusy(false);
    }
  }

  return <section className="sn-draft-group-panel">
    <header><div><span>{title}</span><h2>{drafts.length} 条待确认</h2><p>逐条展开核对，也可以整组确认或退回；批量处理会逐条保存进度。</p></div><div><button type="button" disabled={busy} onClick={() => { void decideAll("reject"); }}>整组退回</button><button className="sn-primary" type="button" disabled={busy || !confirmable} title={confirmable ? undefined : "组内有尚未接入、不可确认或未声明采集入口的领域"} onClick={() => { void decideAll("approve"); }}>整组确认</button></div></header>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <div className="sn-draft-list">{drafts.map((draft) => <DraftCard key={draft.id} draft={draft} sourceTitle={sourceTitle(draft)} target={domains.find((domain) => domain.id === draft.domain)} siblingCount={drafts.length} reload={reload} />)}</div>
  </section>;
}

export function ReviewPage({ data, sessions, reload }: NexusPageProps) {
  const pending = data.drafts.filter((draft) => draft.state === "pending");
  const settled = data.drafts.filter((draft) => draft.state !== "pending");
  const summaries = sessions.list.getSnapshot().byId;
  const sourceTitle = (draft: CaptureDraft) => draft.sessionId.startsWith("domain:")
    ? `${data.domains.find((domain) => domain.id === draft.domain)?.label ?? draft.domain} Agent Proposal`
    : summaries[draft.sessionId as SessionId]?.displayTitle ?? draft.sessionId;
  const groups = [...pending.reduce((result, draft) => {
    const key = draft.captureGroupId ?? draft.id;
    result.set(key, [...(result.get(key) ?? []), draft]);
    return result;
  }, new Map<string, CaptureDraft[]>()).values()];
  return <div className="sn-page sn-review-page">
    <header className="sn-page-header"><span>INBOX / NEEDS YOU</span><h1>只处理真正需要你决定的内容。</h1><p>Nexus 汇总当前交互和各领域 Agent Proposal；事实仍归对应领域所有，确认前不会成为正式记录。</p></header>
    {pending.length === 0 ? <div className="sn-empty"><span>◇</span><h2>暂时没有待处理项</h2><p>直接在底部告诉 Shadow 任何内容；只有需要确认的 Proposal 才会来到这里。</p></div> : groups.map((drafts) => drafts.length > 1
      ? <DraftGroup key={drafts[0]?.captureGroupId ?? drafts[0]?.id} drafts={drafts} sourceTitle={sourceTitle} domains={data.domains} reload={reload} />
      : drafts[0] === undefined ? null : <div className="sn-draft-list" key={drafts[0].id}><DraftCard draft={drafts[0]} sourceTitle={sourceTitle(drafts[0])} target={data.domains.find((domain) => domain.id === drafts[0]?.domain)} siblingCount={1} reload={reload} /></div>)}
    {settled.length > 0 && <section className="sn-history"><h2>全局已处理</h2>{settled.map((draft) => <p key={draft.id}><DomainMark domain={draft.domain} /><span>{draft.summary}</span><em data-state={draft.state}>{draft.state === "approved" ? `已提交 ${data.domains.find((domain) => domain.id === draft.domain)?.label ?? draft.domain}` : "已退回"}</em></p>)}</section>}
  </div>;
}

export function SearchPage({ data }: NexusPageProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NexusSearchResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const searchable = data.domains.filter((domain) => domain.searchEnabled);
  async function search() {
    if (query.trim() === "") return;
    setBusy(true);
    try {
      const next = await nexusJson<NexusSearchResult>(await fetch(nexusEndpoint("search"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 30 })
      }));
      setResult(next);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搜索暂时不可用。");
    } finally { setBusy(false); }
  }
  return <div className="sn-page sn-search-page">
    <header className="sn-page-header"><span>SEARCH / FEDERATED</span><h1>跨领域查找，事实仍留在原处。</h1><p>当前可搜索：{searchable.map((domain) => domain.label).join("、") || "尚无领域"}。Nexus 只返回摘要和稳定资源引用。</p></header>
    <form className="sn-search-box" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料、证据和长期记忆" /><button className="sn-primary" type="submit" disabled={busy || query.trim() === ""}>{busy ? "搜索中…" : "搜索"}</button></form>
    {error !== undefined && <p className="sn-error">{error}</p>}
    {result !== undefined && <section className="sn-search-results"><div className="sn-section-title"><div><span>结果</span><h2>{result.items.length} 条匹配</h2></div><small>{result.unavailableDomains.length > 0 ? `${result.unavailableDomains.length} 个领域暂不可用` : "所有可搜索领域已响应"}</small></div>{result.items.length === 0 ? <div className="sn-empty sn-empty-compact"><h2>没有找到匹配内容</h2></div> : result.items.map((item, index) => <article key={`${item.domain}:${item.reference ?? String(index)}`}><DomainMark domain={item.domain} /><div><span>{item.domainLabel}</span><h3>{item.title}</h3><p>{item.detail}</p>{item.reference !== undefined && <code>{item.reference}</code>}</div></article>)}</section>}
  </div>;
}

export function AppsPage({ data, navigate }: NexusPageProps) {
  return <div className="sn-page sn-apps-page"><header className="sn-page-header"><span>APPS / DOMAIN OWNERS</span><h1>进入领域完整应用。</h1><p>Nexus 负责汇总和编排；完整编辑、设置与长期事实仍由各领域应用拥有，不在这里原生重写。</p></header><div className="sn-apps-grid">{data.domains.map((domain) => domain.appUrl === undefined
    ? <button type="button" key={domain.id} onClick={() => navigate(domain.id)}><DomainMark domain={domain.id} /><div><h2>{domain.label}</h2><p>{domain.caption}</p><span>查看 Nexus 摘要</span></div><em>查看</em></button>
    : <a key={domain.id} href={domain.appUrl} target="_blank" rel="noreferrer"><DomainMark domain={domain.id} /><div><h2>{domain.label}</h2><p>{domain.caption}</p><span>{domain.status === "ready" ? "领域已连接" : "打开独立应用"}</span></div><em>打开 ↗</em></a>)}</div></div>;
}

function DomainPage({ data, showConversation, ask, domainId }: NexusPageProps & { readonly domainId: DomainId }) {
  const domain = data.domains.find((item) => item.id === domainId);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string>();
  if (domain === undefined) return <div className="sn-page"><div className="sn-empty"><h2>领域尚未接入</h2></div></div>;
  const domainLabel = domain.label;
  async function discuss() {
    setAsking(true);
    try {
      const question = `结合已授权数据，和我聊聊 ${domainLabel} 最近值得关注的变化。`;
      await ask(question, { module: domainId, topic: "overview", range: "30d" });
      setAskError(undefined);
    } catch (caught) {
      setAskError(caught instanceof Error ? caught.message : "暂时无法发起对话。");
    } finally {
      setAsking(false);
    }
  }
  return <div className="sn-page sn-domain-page">
    <header className="sn-domain-hero"><DomainMark domain={domain.id} /><div><span>SHADOW DOMAIN</span><h1>{domain.label}</h1><p>{domain.caption}</p></div><StatusDot status={domain.status} /></header>
    <section className="sn-domain-feature"><span>当前摘要</span><strong>{domain.metric}</strong><p>{domain.detail}</p></section>
    <div className="sn-domain-columns"><section><span>事实边界</span><h2>数据留在 {domain.label}</h2><p>Nexus 只读取领域声明允许暴露的摘要、待办和引用，不复制领域事实表。</p></section><section><span>会话协作</span><h2>让 Shadow 继续处理</h2><p>在右侧对话中结合这个领域的页面上下文继续交流。</p><div className="sn-domain-actions"><button type="button" disabled={asking} onClick={() => { void discuss(); }}>{asking ? "正在打开…" : "聊聊这个领域"}</button><button type="button" onClick={showConversation}>展开完整对话</button></div>{askError !== undefined && <p className="sn-error">{askError}</p>}</section></div>
    {domain.status === "offline" && <aside className="sn-boundary"><b>保留入口</b><p>该领域仍在改造中，Nexus 不读取临时接口，也不建立不受支持的兼容层。</p></aside>}
  </div>;
}

export function builtinNexusModules(): readonly NexusModuleDescriptor[] {
  return [
    { id: "nexus:today", apiVersion: 1, title: "现在", route: "today", icon: "◫", group: "home", order: 0, scope: "root", page: TodayPage },
    { id: "nexus:search", apiVersion: 1, title: "搜索", route: "search", icon: "⌕", group: "home", order: 10, scope: "root", page: SearchPage, available: ({ data }) => data.domains.some((domain) => domain.searchEnabled) },
    { id: "nexus:review", apiVersion: 1, title: "待我处理", route: "review", icon: "◇", group: "home", order: 20, scope: "root", page: ReviewPage, badge: ({ data }) => data.drafts.filter((draft) => draft.state === "pending").length || undefined },
    { id: "nexus:apps", apiVersion: 1, title: "应用", route: "apps", icon: "▦", group: "home", order: 30, scope: "root", page: AppsPage }
  ];
}

export function projectedNexusModules(domains: readonly DomainSummary[]): readonly NexusModuleDescriptor[] {
  return domains.map((domain) => ({
    id: `shadow:${domain.id}`,
    apiVersion: 1,
    title: domain.label,
    route: domain.id,
    icon: domain.id.slice(0, 1).toLocaleUpperCase(),
    group: "domains",
    order: domain.order,
    scope: "root",
    page: (props: NexusPageProps) => <DomainPage {...props} domainId={domain.id} />
  }));
}
