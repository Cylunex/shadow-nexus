import type { SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { useState } from "react";
import type { ActivityEntry, CaptureDraft, DomainEntity, DomainId, DomainMetric, DomainSummary, NexusMemory, NexusPreferences, NexusQuickAction, NexusQuickActionField, NexusSearchResult, NexusSuggestion, SuggestionAction, TodaySignal } from "../contracts.js";
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

function SuggestionCard({ suggestion, reload, addContext, ask }: {
  readonly suggestion: NexusSuggestion;
  readonly reload: () => Promise<void>;
  readonly addContext: NexusPageProps["addContext"];
  readonly ask: NexusPageProps["ask"];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function feedback(action: Extract<SuggestionAction, "ignore" | "snooze" | "mute">) {
    setBusy(true);
    try {
      await nexusJson(await fetch(nexusEndpoint("suggestions/action"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestion, action })
      }));
      setError(undefined);
      await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "建议操作失败。"); }
    finally { setBusy(false); }
  }
  async function discuss(createDraft: boolean) {
    setBusy(true);
    try {
      const goal = createDraft ? `基于“${suggestion.title}”生成可审核的调整草稿` : `理解“${suggestion.title}”的依据`;
      const context = await addContext({ source_domain: suggestion.domain, resource_refs: suggestion.evidence_refs, goal });
      await ask(createDraft
        ? `请根据“${suggestion.title}”的证据生成调整草稿；不要直接写入任何领域事实。`
        : `请解释“${suggestion.title}”的证据、数据缺口和可采取的下一步。`, {
        module: "suggestion", topic: suggestion.title, contextId: context.context_id,
        resourceRefs: context.resource_refs, goal
      });
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法打开建议上下文。"); }
    finally { setBusy(false); }
  }
  return <article className="sn-suggestion" data-importance={suggestion.importance}>
    <header><DomainMark domain={suggestion.domain} /><div><span>建议 · {suggestion.domain}</span><h3>{suggestion.title}</h3></div><em>{Math.round((suggestion.confidence ?? 0) * 100)}%</em></header>
    <p>{suggestion.summary}</p><small>{suggestion.reason}</small>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <footer>
      {suggestion.allowed_actions.includes("view_evidence") && <button disabled={busy} type="button" onClick={() => { void discuss(false); }}>查看证据</button>}
      {suggestion.allowed_actions.includes("create_draft") && <button className="sn-primary" disabled={busy} type="button" onClick={() => { void discuss(true); }}>创建调整草稿</button>}
      {suggestion.allowed_actions.includes("snooze") && <button disabled={busy} type="button" onClick={() => { void feedback("snooze"); }}>稍后提醒</button>}
      {suggestion.allowed_actions.includes("ignore") && <button disabled={busy} type="button" onClick={() => { void feedback("ignore"); }}>忽略本次</button>}
      {suggestion.allowed_actions.includes("mute") && <button disabled={busy} type="button" onClick={() => { void feedback("mute"); }}>不再显示此类</button>}
    </footer>
  </article>;
}

function sameLocalDay(value: string, reference: string): boolean {
  const left = new Date(value);
  const right = new Date(reference);
  return !Number.isNaN(left.valueOf()) && !Number.isNaN(right.valueOf())
    && left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function domainMetrics(domain: DomainSummary): readonly DomainMetric[] {
  return domain.metrics?.length
    ? domain.metrics.slice(0, 4)
    : [{ id: "primary", label: "当前", value: domain.metric, detail: domain.detail }];
}

function DashboardDomainCard({ domain, navigate }: { readonly domain: DomainSummary; readonly navigate: NexusPageProps["navigate"] }) {
  return <button className="sn-dashboard-domain" type="button" data-status={domain.status} onClick={() => navigate(domain.id)}>
    <header><DomainMark domain={domain.id} /><div><strong>{domain.label}</strong><span>{domain.caption}</span></div><StatusDot status={domain.status} /></header>
    <div className="sn-dashboard-metrics">{domainMetrics(domain).map((metric) => <div key={metric.id} data-tone={metric.tone ?? "neutral"} title={metric.detail}>
      <span>{metric.label}</span><strong>{metric.value}</strong>{metric.detail !== undefined && <small>{metric.detail}</small>}
    </div>)}</div>
    <footer><span>{domain.status === "ready" ? "数据已同步" : domain.status === "attention" ? "需要关注" : "暂未连接"}</span><em>查看领域摘要 →</em></footer>
  </button>;
}

function focusQuickAction(entity: DomainEntity): void {
  const actionId = entity.actionIds[0];
  if (actionId === undefined) return;
  const card = document.getElementById(`quick-${entity.domain}-${actionId}`);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  card?.querySelector<HTMLButtonElement>(".sn-quick-action-head")?.click();
}

function EntityCard({ entity, domain }: { readonly entity: DomainEntity; readonly domain: DomainSummary }) {
  return <article className="sn-entity" data-availability={entity.availability} data-tone={entity.tone}>
    <header><DomainMark domain={entity.domain} /><div><span>{domain.label} · {entity.class}</span><strong>{entity.label}</strong></div><em>{entity.availability === "fresh" ? "已同步" : entity.availability === "stale" ? "待刷新" : "暂无"}</em></header>
    <p><strong>{entity.value}</strong>{entity.unit !== undefined && entity.value !== "—" ? <small>{entity.unit}</small> : null}</p>
    <footer><span>{entity.sensitivity === "sensitive" || entity.sensitivity === "restricted" ? "敏感信息" : "个人信息"}</span>{entity.actionIds.length > 0 && <button type="button" disabled={domain.status !== "ready"} onClick={() => focusQuickAction(entity)}>快速记录</button>}</footer>
  </article>;
}

function quickActionDefault(field: NexusQuickActionField): string {
  if (field.default === "$today") {
    const now = new Date();
    return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  if (field.default === "$now") return new Date().toISOString();
  return field.default ?? "";
}

function QuickActionCard({ action, domain, sessionId, reload }: {
  readonly action: NexusQuickAction;
  readonly domain: DomainSummary;
  readonly sessionId: string | undefined;
  readonly reload: () => Promise<void>;
}) {
  const visibleFields = action.fields.filter((field) => field.type !== "hidden");
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(visibleFields.map((field) => [field.id, quickActionDefault(field)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  async function submit() {
    setBusy(true);
    try {
      const draft = await nexusJson<CaptureDraft>(await fetch(nexusEndpoint("quick-actions/execute"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: action.domain, actionId: action.id, fields: values, ...(sessionId === undefined ? {} : { sessionId }) })
      }));
      setOutcome(draft.state === "approved" ? action.successMessage : draft.reviewReason === "execution-failed" ? "自动执行失败，已转入复核。" : "已进入待复核队列。");
      setError(undefined);
      await reload();
    } catch (caught) {
      const shell = (globalThis as typeof globalThis & { readonly ShellBridge?: { enqueueOfflineAction?(value: string): string } }).ShellBridge;
      if (caught instanceof TypeError && shell?.enqueueOfflineAction !== undefined) {
        try {
          const queuedId = shell.enqueueOfflineAction(JSON.stringify({ sessionId, domain: action.domain, actionId: action.id, fields: values }));
          if (queuedId === "") throw new Error("queue rejected");
          setOutcome(`网络不可用，已加密排队（${queuedId}）`); setError(undefined);
        } catch { setError("离线动作无法安全排队。"); setOutcome(undefined); }
      } else { setError(caught instanceof Error ? caught.message : "快捷动作执行失败。"); setOutcome(undefined); }
    } finally { setBusy(false); }
  }
  return <article id={`quick-${action.domain}-${action.id}`} className="sn-quick-action" data-expanded={expanded}>
    <button className="sn-quick-action-head" type="button" disabled={domain.status !== "ready"} onClick={() => setExpanded((value) => !value)}>
      <DomainMark domain={action.domain} /><div><strong>{action.title}</strong><span>{action.description}</span></div><em>{domain.status === "ready" ? expanded ? "收起" : "开始" : "未连接"}</em>
    </button>
    {expanded && <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="sn-quick-fields">{visibleFields.map((field) => <label key={field.id}><span>{field.label}{field.unit === undefined ? "" : ` · ${field.unit}`}</span>{field.type === "select"
        ? <select value={values[field.id] ?? ""} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}>{!field.required && <option value="">不填写</option>}{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input type={field.type === "decimal" || field.type === "integer" ? "number" : field.type === "datetime" ? "datetime-local" : field.type} value={values[field.id] ?? ""} required={field.required} placeholder={field.placeholder} min={field.minimum} max={field.maximum} step={field.step} maxLength={field.maxLength} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} />}</label>)}</div>
      <footer><span>{action.risk === "high" ? "高影响操作仍需明确复核" : "提交后由领域校验并保留回执"}</span><button className="sn-primary" type="submit" disabled={busy}>{busy ? "处理中…" : action.submitLabel}</button></footer>
      {outcome !== undefined && <p className="sn-quick-outcome">✓ {outcome}</p>}
      {error !== undefined && <p className="sn-error">{error}</p>}
    </form>}
  </article>;
}

export function TodayPage({ sessionId, data, navigate, recentSessions = [], continueSession, reload, addContext, ask }: NexusPageProps) {
  const pending = data.drafts.filter((draft) => draft.state === "pending").length;
  const exceptions = data.activity.filter((entry) => entry.reviewRequired || entry.status === "prohibited").slice(0, 4);
  const suggestions = data.suggestions ?? [];
  const connected = data.domains.filter((domain) => domain.status === "ready").length;
  const automaticToday = data.drafts.filter((draft) => draft.state === "approved" && draft.decisionMode === "automatic"
    && sameLocalDay(draft.updatedAt ?? draft.createdAt, data.generatedAt)).length;
  const recentActivity = data.drafts.filter((draft) => draft.state !== "pending")
    .toSorted((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)).slice(0, 6);
  const generatedTime = new Date(data.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const quickActions = data.domains.flatMap((domain) => (domain.quickActions ?? []).map((action) => ({ action, domain })))
    .toSorted((left, right) => left.action.order - right.action.order || left.domain.order - right.domain.order);
  const entities = data.domains.flatMap((domain) => (domain.entities ?? []).map((entity) => ({ entity, domain })))
    .toSorted((left, right) => {
      const availability = { stale: 0, fresh: 1, unavailable: 2 } as const;
      return availability[left.entity.availability] - availability[right.entity.availability]
        || left.entity.order - right.entity.order || left.domain.order - right.domain.order;
    });
  const entityAlerts = entities.filter(({ entity }) => entity.attention !== undefined).slice(0, 4);
  return <div className="sn-page sn-page-today">
    <header className="sn-hero sn-dashboard-hero">
      <div><span className="sn-kicker">SHADOW / DASHBOARD</span><h1>常用信息，都在这里。</h1><p>各领域项目继续保管事实；Nexus 只聚合已声明的摘要、建议和执行回执。</p></div>
      <div className="sn-date"><strong>{data.dateLabel}</strong><span>{data.mode === "connected" ? `最近聚合 ${generatedTime}` : "等待领域接入"}</span><button type="button" onClick={() => { void reload(); }}>刷新数据</button></div>
    </header>
    <section className="sn-dashboard-stats" aria-label="数据面板概览">
      <article><span>领域在线</span><strong>{connected}<small> / {data.domains.length}</small></strong><p>只读连接状态</p></article>
      <article data-tone={pending > 0 ? "attention" : "calm"}><span>待你复核</span><strong>{pending}</strong><p>仅高影响与例外</p></article>
      <article><span>Agent 今日完成</span><strong>{automaticToday}</strong><p>均保留领域回执</p></article>
      <article data-tone={suggestions.length > 0 ? "attention" : "calm"}><span>有效建议</span><strong>{suggestions.length}</strong><p>可查看证据与处理</p></article>
    </section>
    {data.brief !== null && <section className="sn-brief" data-severity={data.brief.severity}><div><span>主动简报 · {data.preferences.briefCadence === "weekly" ? "每周" : "每日"}</span><h2>{data.brief.title}</h2><p>{data.brief.body}</p></div><em>{data.brief.notify ? "已允许原生提醒" : "仅在首页展示"}</em></section>}
    {exceptions.length + entityAlerts.length > 0 && <section className="sn-section sn-attention-section">
      <div className="sn-section-title"><div><span>需要你</span><h2>只有例外和高影响操作打断你</h2></div><button type="button" onClick={() => navigate("review")}>进入复核</button></div>
      <div className="sn-attention-list">{exceptions.map((entry) => <button type="button" key={entry.id} onClick={() => navigate("review")}><DomainMark domain={entry.domain} /><div><strong>{entry.title}</strong><span>{entry.detail}</span></div><em>{entry.status === "failed" ? "自动执行失败" : entry.status === "prohibited" ? "策略已阻止" : "等待决定"}</em></button>)}{entityAlerts.map(({ entity }) => <button type="button" key={`${entity.domain}:${entity.id}:${entity.attention?.ruleId}`} onClick={() => entity.actionIds.length > 0 ? focusQuickAction(entity) : navigate(entity.domain)}><DomainMark domain={entity.domain} /><div><strong>{entity.label}</strong><span>{entity.attention?.message}</span></div><em>{entity.attention?.severity === "warning" ? "重要提醒" : "需要关注"}</em></button>)}</div>
    </section>}
    {entities.length > 0 && <section className="sn-section sn-entity-section">
      <div className="sn-section-title"><div><span>现在</span><h2>稳定实体，不再只是零散指标</h2></div><small>{entities.filter(({ entity }) => entity.availability === "fresh").length} 项最新</small></div>
      <div className="sn-entity-grid">{entities.slice(0, 12).map(({ entity, domain }) => <EntityCard key={`${entity.domain}:${entity.id}`} entity={entity} domain={domain} />)}</div>
    </section>}
    {quickActions.length > 0 && <section className="sn-section sn-quick-section">
      <div className="sn-section-title"><div><span>快捷操作</span><h2>常用动作不再进入领域应用</h2></div><small>领域校验 · 自动执行 · 可复核</small></div>
      <div className="sn-quick-grid">{quickActions.map(({ action, domain }) => <QuickActionCard key={`${action.domain}:${action.id}`} action={action} domain={domain} sessionId={sessionId} reload={reload} />)}</div>
    </section>}
    <section className="sn-command">
      <button type="button" onClick={() => document.querySelector<HTMLTextAreaElement>(".sn-assistant-bar textarea")?.focus()}><span>＋</span><div><strong>告诉 Shadow</strong><small>聊天、记录、分析和附件使用同一个入口</small></div><kbd>⌘ Enter</kbd></button>
      <button type="button" onClick={() => navigate("review")}><span>◇</span><div><strong>{pending > 0 ? `${pending} 项需要决定` : "没有待处理例外"}</strong><small>Agent 默认自动完成 L0-L2，结果仍可复核</small></div><em>查看记录</em></button>
    </section>
    <section className="sn-section">
      <div className="sn-section-title"><div><span>常用数据</span><h2>跨项目摘要，一眼看全</h2></div><small>点击卡片查看领域上下文</small></div>
      {data.domains.length === 0
        ? <div className="sn-empty sn-empty-compact"><span>·</span><h2>尚无领域投影</h2><p>Platform 编译领域 Summary 后，这里会自动出现，不需要修改 Nexus。</p></div>
        : <div className="sn-dashboard-domain-grid">{data.domains.map((domain) => <DashboardDomainCard key={domain.id} domain={domain} navigate={navigate} />)}</div>}
    </section>
    {suggestions.length > 0 && <section className="sn-section">
      <div className="sn-section-title"><div><span>需要关注</span><h2>有证据的跨领域建议</h2></div><small>{suggestions.length} 条有效建议</small></div>
      <div className="sn-suggestion-list">{suggestions.map((suggestion) => <SuggestionCard key={suggestion.suggestion_id} suggestion={suggestion} reload={reload} addContext={addContext} ask={ask} />)}</div>
    </section>}
    <section className="sn-section">
      <div className="sn-section-title"><div><span>最新摘要</span><h2>各底座项目最近返回的变化</h2></div><small>{data.signals.length} 条聚合信号</small></div>
      {data.signals.length === 0
        ? <div className="sn-empty sn-empty-compact"><span>·</span><h2>暂时没有聚合信号</h2><p>领域服务连接后，最新摘要会在这里出现。</p></div>
        : <div className="sn-signal-grid">{data.signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>}
    </section>
    {recentActivity.length > 0 && <section className="sn-section">
      <div className="sn-section-title"><div><span>最近处理</span><h2>Agent 与人工操作都可回看</h2></div><small>最近 {recentActivity.length} 条</small></div>
      <div className="sn-dashboard-activity">{recentActivity.map((draft) => <article key={draft.id}><DomainMark domain={draft.domain} /><div><strong>{draft.summary}</strong><span>{draft.decisionMode === "automatic" ? "Agent 自动处理" : draft.state === "approved" ? "人工确认" : "已退回"} · {data.domains.find((domain) => domain.id === draft.domain)?.label ?? draft.domain}</span></div><time>{new Date(draft.updatedAt ?? draft.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>)}</div>
    </section>}
    {recentSessions.length > 0 && <section className="sn-section sn-continue-section">
      <div className="sn-section-title"><div><span>继续</span><h2>回到最近的上下文</h2></div><small>DSH Session 只作为底层容器</small></div>
      <div className="sn-continue-list">{recentSessions.slice(0, 4).map((session) => <button type="button" key={session.id} data-current={session.current} onClick={() => continueSession?.(session.id)}><span>{session.current ? "当前" : "最近"}</span><strong>{session.title}</strong><em>继续对话</em></button>)}</div>
    </section>}
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
    <header><DomainMark domain={draft.domain} /><div><span>{draft.state === "approved" ? draft.decisionMode === "automatic" ? "Agent 已自动完成" : "已确认完成" : "已退回"}</span><time>{draft.summary}</time></div><em>{draft.state === "approved" ? "✓" : "—"}</em></header>
    {draft.receipt !== undefined && <p>Receipt · {draft.receipt}</p>}
  </article>;
  return <article className="sn-draft" data-compact={compact}>
    <header><DomainMark domain={draft.domain} /><div><span>{draft.intent}</span><time>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 来源：{sourceTitle}</time></div><em data-risk={draft.risk}>{draft.risk === "low" ? "低风险" : draft.risk === "medium" ? "需确认" : "高风险"}</em></header>
    <h3>{draft.summary}</h3>
    <div className="sn-draft-target" data-ready={connectedTarget}>
      <DomainMark domain={draft.domain} />
      <p><strong>{connectedTarget ? `将提交到 ${targetLabel}` : `${targetLabel} 暂不可提交`}</strong><span>{connectedTarget ? draft.origin === "domain" ? `已关联 ${targetLabel} 现有 Proposal；确认时提交同一对象，不会重复创建。` : draft.match === "existing" ? "已找到相同 Proposal，不会重复创建或写入。" : draft.risk === "high" ? "这是高影响操作；确认后由 Nexus 生成短时签名回执再执行。" : `确认后按 ${targetLabel} 声明的审核协议执行，并返回领域凭证。` : "领域连接、采集入口或确认状态当前不可用。"}</span></p>
    </div>
    {draft.reviewReason === "execution-failed" && <p className="sn-draft-group">自动执行未完成：{draft.executionError ?? "请检查领域连接后重试。"}</p>}
    {draft.reviewReason === "high-risk" && <p className="sn-draft-group">这是高影响操作，仍需你明确复核后执行。</p>}
    {draft.reviewReason === "policy" && <p className="sn-draft-group">当前部署启用了 review-first 恢复策略，需要人工复核。</p>}
    {draft.reviewReason === "prohibited" && <p className="sn-draft-group">这是受保护操作，Nexus 不提供执行入口。</p>}
    {siblingCount > 1 && <p className="sn-draft-group">同一次记录已拆成 {siblingCount} 张领域草稿，请分别核对和确认。</p>}
    <section className="sn-draft-fields"><h4>将提交的字段</h4><dl>{visibleFields.map(([key, value]) => <div key={key} data-field={key}><dt>{fieldLabel(key)}</dt><dd>{displayFieldValue(value)}</dd></div>)}</dl></section>
    {!compact && <details className="sn-draft-source"><summary>查看完整原文 <span>{draft.text.length} 字 · 可拖动右下角放大</span></summary><pre>{draft.text}</pre></details>}
    {error !== undefined && <p className="sn-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={() => { void decide("reject"); }}>退回</button><button className="sn-primary" type="button" disabled={busy || !connectedTarget} title={connectedTarget ? undefined : "目标领域尚未连接或未声明采集入口"} onClick={() => { void decide("approve"); }}>{connectedTarget ? draft.reviewReason === "execution-failed" ? `重试提交 ${targetLabel}` : draft.risk === "high" ? `明确确认并执行 ${targetLabel}` : `确认并提交 ${targetLabel}` : "暂不可提交"}</button></footer>
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
    <header className="sn-page-header"><span>REVIEW / EXCEPTIONS</span><h1>信任 Agent，集中复核结果和例外。</h1><p>Nexus 默认自动执行低至中风险操作并保留领域凭证；这里只要求你处理高影响、受保护或执行失败的项目。</p></header>
    {pending.length === 0 ? <div className="sn-empty"><span>◇</span><h2>没有需要你处理的例外</h2><p>Agent 的自动执行结果仍保留在下方复核记录中。</p></div> : groups.map((drafts) => drafts.length > 1
      ? <DraftGroup key={drafts[0]?.captureGroupId ?? drafts[0]?.id} drafts={drafts} sourceTitle={sourceTitle} domains={data.domains} reload={reload} />
      : drafts[0] === undefined ? null : <div className="sn-draft-list" key={drafts[0].id}><DraftCard draft={drafts[0]} sourceTitle={sourceTitle(drafts[0])} target={data.domains.find((domain) => domain.id === drafts[0]?.domain)} siblingCount={1} reload={reload} /></div>)}
    {settled.length > 0 && <section className="sn-history"><h2>复核记录</h2>{settled.map((draft) => <p key={draft.id}><DomainMark domain={draft.domain} /><span>{draft.summary}</span><em data-state={draft.state}>{draft.state === "approved" ? `${draft.decisionMode === "automatic" ? "Agent 自动提交" : "人工确认提交"} · ${data.domains.find((domain) => domain.id === draft.domain)?.label ?? draft.domain}` : "已退回"}</em></p>)}</section>}
  </div>;
}

export function SearchPage({ data, addContext, ask }: NexusPageProps) {
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
  async function askAbout(item: NexusSearchResult["items"][number]) {
    if (item.reference === undefined) return;
    setBusy(true);
    try {
      const goal = `理解“${item.title}”并回答后续问题`;
      const context = await addContext({
        source_domain: item.domain,
        resource_refs: [item.reference],
        goal
      });
      await ask(`请先说明“${item.title}”最值得关注的内容。`, {
        module: "search",
        topic: item.title,
        contextId: context.context_id,
        resourceRefs: context.resource_refs,
        goal
      });
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法把这个结果加入当前上下文。");
    } finally { setBusy(false); }
  }
  return <div className="sn-page sn-search-page">
    <header className="sn-page-header"><span>SEARCH / FEDERATED</span><h1>跨领域查找，事实仍留在原处。</h1><p>当前可搜索：{searchable.map((domain) => domain.label).join("、") || "尚无领域"}。Nexus 只返回摘要和稳定资源引用。</p></header>
    <form className="sn-search-box" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料、证据和长期记忆" /><button className="sn-primary" type="submit" disabled={busy || query.trim() === ""}>{busy ? "搜索中…" : "搜索"}</button></form>
    {error !== undefined && <p className="sn-error">{error}</p>}
    {result !== undefined && <section className="sn-search-results"><div className="sn-section-title"><div><span>结果</span><h2>{result.items.length} 条匹配</h2></div><small>{result.unavailableDomains.length > 0 ? `${result.unavailableDomains.length} 个领域暂不可用` : "所有可搜索领域已响应"}</small></div>{result.items.length === 0 ? <div className="sn-empty sn-empty-compact"><h2>没有找到匹配内容</h2></div> : result.items.map((item, index) => <article key={`${item.domain}:${item.reference ?? String(index)}`}><DomainMark domain={item.domain} /><div><span>{item.domainLabel}</span><h3>{item.title}</h3><p>{item.detail}</p>{item.reference !== undefined && <><code>{item.reference}</code><button type="button" disabled={busy} onClick={() => { void askAbout(item); }}>询问这个</button></>}</div></article>)}</section>}
  </div>;
}

export function AppsPage({ data, navigate }: NexusPageProps) {
  return <div className="sn-page sn-apps-page"><header className="sn-page-header"><span>APPS / DOMAIN OWNERS</span><h1>进入领域完整应用。</h1><p>Nexus 负责汇总和编排；完整编辑、设置与长期事实仍由各领域应用拥有，不在这里原生重写。</p></header><div className="sn-apps-grid">{data.domains.map((domain) => domain.appUrl === undefined
    ? <button type="button" key={domain.id} onClick={() => navigate(domain.id)}><DomainMark domain={domain.id} /><div><h2>{domain.label}</h2><p>{domain.caption}</p><span>查看 Nexus 摘要</span></div><em>查看</em></button>
    : <a key={domain.id} href={domain.appUrl} target="_blank" rel="noreferrer"><DomainMark domain={domain.id} /><div><h2>{domain.label}</h2><p>{domain.caption}</p><span>{domain.status === "ready" ? "领域已连接" : "打开独立应用"}</span></div><em>打开 ↗</em></a>)}</div></div>;
}

function DomainPage({ data, showConversation, ask, addContext, domainId }: NexusPageProps & { readonly domainId: DomainId }) {
  const domain = data.domains.find((item) => item.id === domainId);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string>();
  if (domain === undefined) return <div className="sn-page"><div className="sn-empty"><h2>领域尚未接入</h2></div></div>;
  const domainLabel = domain.label;
  async function discuss() {
    setAsking(true);
    try {
      const goal = `理解 ${domainLabel} 最近值得关注的变化`;
      const context = await addContext({
        source_domain: domainId,
        resource_refs: [`shadow://${domainId}/overview`],
        goal
      });
      const question = `结合已授权数据，和我聊聊 ${domainLabel} 最近值得关注的变化。`;
      await ask(question, { module: domainId, topic: "overview", range: "30d", contextId: context.context_id, resourceRefs: context.resource_refs, goal });
      setAskError(undefined);
    } catch (caught) {
      setAskError(caught instanceof Error ? caught.message : "暂时无法发起对话。");
    } finally {
      setAsking(false);
    }
  }
  return <div className="sn-page sn-domain-page">
    <header className="sn-domain-hero"><DomainMark domain={domain.id} /><div><span>SHADOW DOMAIN</span><h1>{domain.label}</h1><p>{domain.caption}</p></div><StatusDot status={domain.status} /></header>
    <section className="sn-domain-feature"><span>当前摘要</span><strong>{domain.metric}</strong><p>{domain.detail}</p>{domain.metrics !== undefined && domain.metrics.length > 1 && <div className="sn-dashboard-metrics sn-domain-metrics">{domain.metrics.slice(0, 8).map((metric) => <div key={metric.id} data-tone={metric.tone ?? "neutral"}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.detail !== undefined && <small>{metric.detail}</small>}</div>)}</div>}</section>
    <div className="sn-domain-columns"><section><span>事实边界</span><h2>数据留在 {domain.label}</h2><p>Nexus 只读取领域声明允许暴露的摘要、待办和引用，不复制领域事实表。</p></section><section><span>会话协作</span><h2>让 Shadow 继续处理</h2><p>在右侧对话中结合这个领域的页面上下文继续交流。</p><div className="sn-domain-actions"><button type="button" disabled={asking} onClick={() => { void discuss(); }}>{asking ? "正在打开…" : "聊聊这个领域"}</button><button type="button" onClick={showConversation}>展开完整对话</button></div>{askError !== undefined && <p className="sn-error">{askError}</p>}</section></div>
    {domain.status === "offline" && <aside className="sn-boundary"><b>保留入口</b><p>该领域仍在改造中，Nexus 不读取临时接口，也不建立不受支持的兼容层。</p></aside>}
  </div>;
}

const activityLabels: Readonly<Record<ActivityEntry["status"], string>> = {
  pending: "等待复核",
  completed: "已完成",
  rejected: "已退回",
  failed: "执行失败",
  prohibited: "策略阻止"
};

export function MemoryPage({ data, reload }: NexusPageProps) {
  const [content, setContent] = useState("");
  const [sensitivity, setSensitivity] = useState<NexusMemory["sensitivity"]>("personal");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create() {
    if (content.trim() === "") return;
    setBusy(true);
    try {
      await nexusJson(await fetch(nexusEndpoint("memory/create"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: content.trim(), sensitivity, expiresInDays: Number(expiresInDays), sourceRefs: ["shadow://nexus/manual"] }) }));
      setContent(""); setError(undefined); await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "记忆保存失败。"); }
    finally { setBusy(false); }
  }
  async function correct(memory: NexusMemory) {
    const next = globalThis.prompt("修正这条记忆", memory.content)?.trim();
    if (next === undefined || next === "" || next === memory.content) return;
    setBusy(true);
    try { await nexusJson(await fetch(nexusEndpoint("memory/correct"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: memory.id, content: next, sourceRefs: ["shadow://nexus/manual-correction"] }) })); await reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "记忆修正失败。"); }
    finally { setBusy(false); }
  }
  async function forget(memory: NexusMemory) {
    setBusy(true);
    try { await nexusJson(await fetch(nexusEndpoint("memory/forget"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: memory.id }) })); await reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "记忆遗忘失败。"); }
    finally { setBusy(false); }
  }
  async function downloadExport() {
    setBusy(true);
    try {
      const response = await fetch(nexusEndpoint("export"), { cache: "no-store" });
      if (!response.ok) throw new Error("导出失败。");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `shadow-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "导出失败。"); }
    finally { setBusy(false); }
  }
  return <div className="sn-page sn-memory-page"><header className="sn-page-header"><span>MEMORY / GOVERNED</span><h1>记住有来源，也允许修正和遗忘。</h1><p>Nexus 只保存你明确创建的跨领域记忆；每条记录都有来源、版本、敏感级别和有效期，不把聊天内容自动变成长久事实。</p></header>
    <section className="sn-memory-create"><textarea value={content} maxLength={2000} onChange={(event) => setContent(event.target.value)} placeholder="例如：我更喜欢在晚饭后安排轻量训练。" /><label>敏感级别<select value={sensitivity} onChange={(event) => setSensitivity(event.target.value as NexusMemory["sensitivity"])}><option value="personal">个人</option><option value="sensitive">敏感</option></select></label><label>有效天数<input type="number" min="1" max="3650" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} /></label><button className="sn-primary" type="button" disabled={busy || content.trim() === ""} onClick={() => { void create(); }}>保存记忆</button></section>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <section className="sn-section"><div className="sn-section-title"><div><span>有效记忆</span><h2>{data.memories.length} 条由你治理的上下文</h2></div><button type="button" disabled={busy} onClick={() => { void downloadExport(); }}>导出 Shadow 数据</button></div><div className="sn-memory-list">{data.memories.length === 0 ? <div className="sn-empty sn-empty-compact"><h2>尚无长期记忆</h2></div> : data.memories.map((memory) => <article key={`${memory.id}:${String(memory.version)}`} data-state={memory.state}><header><span>{memory.sensitivity === "sensitive" ? "敏感" : "个人"} · v{memory.version}</span><time>{memory.expiresAt === undefined ? "长期有效" : `有效至 ${new Date(memory.expiresAt).toLocaleDateString("zh-CN")}`}</time></header><p>{memory.content}</p><footer><code>{memory.sourceRefs.join(" · ")}</code><button type="button" disabled={busy} onClick={() => { void correct(memory); }}>修正</button><button type="button" disabled={busy} onClick={() => { void forget(memory); }}>遗忘</button></footer></article>)}</div></section>
  </div>;
}

export function ActivityPage({ data, navigate }: NexusPageProps) {
  return <div className="sn-page sn-activity-page">
    <header className="sn-page-header"><span>ACTIVITY / RECEIPTS</span><h1>发生了什么，一条账本说清楚。</h1><p>Agent 自动完成、人工确认、失败升级和策略阻止使用同一种活动语义；这里不展示草稿中的敏感字段。</p></header>
    <section className="sn-activity-ledger">{data.activity.length === 0
      ? <div className="sn-empty sn-empty-compact"><h2>还没有活动</h2><p>执行快捷动作或处理 Proposal 后，会在这里留下可复核记录。</p></div>
      : data.activity.map((entry) => <article key={entry.id} data-status={entry.status}>
        <DomainMark domain={entry.domain} /><div><span>{data.domains.find((domain) => domain.id === entry.domain)?.label ?? entry.domain} · {entry.actor === "agent" ? "Agent" : "你"}</span><h2>{entry.title}</h2><p>{entry.detail}</p></div>
        <aside><strong>{activityLabels[entry.status]}</strong><time>{new Date(entry.occurredAt).toLocaleString("zh-CN")}</time><small>{entry.receiptAvailable ? "回执已保留" : entry.reviewRequired ? "可进入复核" : "无写入回执"}</small></aside>
      </article>)}</section>
    {data.trust.pending + data.trust.failed > 0 && <button className="sn-primary sn-activity-review" type="button" onClick={() => navigate("review")}>处理 {data.trust.pending + data.trust.failed} 项例外</button>}
  </div>;
}

export function TrustPage({ data, navigate, reload }: NexusPageProps) {
  const [preferences, setPreferences] = useState<NexusPreferences>(data.preferences);
  const [saving, setSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string>();
  const resolved = data.trust.automatic + data.trust.manual + data.trust.rejected;
  const automaticRate = resolved === 0 ? 0 : Math.round(data.trust.automatic / resolved * 100);
  async function savePreferences() {
    setSaving(true);
    try {
      await nexusJson(await fetch(nexusEndpoint("preferences"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(preferences) }));
      setPreferenceError(undefined);
      await reload();
    } catch (caught) { setPreferenceError(caught instanceof Error ? caught.message : "偏好保存失败。"); }
    finally { setSaving(false); }
  }
  return <div className="sn-page sn-trust-page">
    <header className="sn-page-header"><span>TRUST / CONTROL</span><h1>默认信任 Agent，保留看得见的控制。</h1><p>L0–L2 默认自动执行并留回执；L3 明确复核；L4 直接阻止。自动失败不会重试写入，而是升级为例外。</p></header>
    <section className="sn-trust-score"><div><span>自动完成占比</span><strong>{automaticRate}<small>%</small></strong><p>在已处理项目中，无需逐项确认</p></div><div><span>自动完成</span><strong>{data.trust.automatic}</strong><p>均保留领域回执</p></div><div><span>人工确认</span><strong>{data.trust.manual}</strong><p>高影响或策略要求</p></div><div data-tone={data.trust.failed + data.trust.pending > 0 ? "attention" : "calm"}><span>当前例外</span><strong>{data.trust.failed + data.trust.pending}</strong><p>失败与待复核</p></div></section>
    <section className="sn-section"><div className="sn-section-title"><div><span>执行边界</span><h2>信任不是取消复核，而是把复核放到例外</h2></div><button type="button" onClick={() => navigate("activity")}>查看活动账本</button></div><div className="sn-policy-grid"><article><b>L0–L2</b><strong>自动执行</strong><p>参数仍由领域校验，幂等写入并保留回执。</p></article><article><b>L3</b><strong>明确复核</strong><p>高影响操作必须由你决定，确认可签名。</p></article><article><b>L4</b><strong>策略阻止</strong><p>保护性边界不允许在 Nexus 中绕过。</p></article></div></section>
    <section className="sn-section"><div className="sn-section-title"><div><span>主动偏好</span><h2>简报有节奏，敏感信息默认不进通知</h2></div><small>持久化在 Nexus 控制面</small></div><div className="sn-preferences">
      <label><span>简报频率</span><select value={preferences.briefCadence} onChange={(event) => setPreferences((current) => ({ ...current, briefCadence: event.target.value as NexusPreferences["briefCadence"] }))}><option value="daily">每日</option><option value="weekly">每周</option><option value="off">关闭</option></select></label>
      <label><span>静默开始</span><input type="time" value={preferences.quietHoursStart} onChange={(event) => setPreferences((current) => ({ ...current, quietHoursStart: event.target.value }))} /></label>
      <label><span>静默结束</span><input type="time" value={preferences.quietHoursEnd} onChange={(event) => setPreferences((current) => ({ ...current, quietHoursEnd: event.target.value }))} /></label>
      <label className="sn-toggle"><input type="checkbox" checked={preferences.notificationsEnabled} onChange={(event) => setPreferences((current) => ({ ...current, notificationsEnabled: event.target.checked }))} /><span>允许原生简报通知</span></label>
      <label className="sn-toggle"><input type="checkbox" checked={preferences.sensitivePreviews} onChange={(event) => setPreferences((current) => ({ ...current, sensitivePreviews: event.target.checked }))} /><span>通知可显示敏感预览</span></label>
      <button className="sn-primary" type="button" disabled={saving} onClick={() => { void savePreferences(); }}>{saving ? "保存中…" : "保存偏好"}</button>
    </div>{preferenceError !== undefined && <p className="sn-error">{preferenceError}</p>}</section>
    {data.trust.domains.length > 0 && <section className="sn-section"><div className="sn-section-title"><div><span>领域分布</span><h2>信任行为可按底座项目追溯</h2></div><small>{data.trust.total} 条活动</small></div><div className="sn-trust-domains">{data.trust.domains.map((stats) => <article key={stats.domain}><DomainMark domain={stats.domain} /><strong>{data.domains.find((domain) => domain.id === stats.domain)?.label ?? stats.domain}</strong><span>自动 {stats.automatic}</span><span>人工 {stats.manual}</span><span>退回 {stats.rejected}</span><span>待处理 {stats.pending + stats.failed}</span><span>阻止 {stats.prohibited}</span></article>)}</div></section>}
  </div>;
}

export function builtinNexusModules(): readonly NexusModuleDescriptor[] {
  return [
    { id: "nexus:today", apiVersion: 1, title: "数据面板", route: "today", icon: "◫", group: "home", order: 0, scope: "root", page: TodayPage },
    { id: "nexus:search", apiVersion: 1, title: "搜索", route: "search", icon: "⌕", group: "home", order: 10, scope: "root", page: SearchPage, available: ({ data }) => data.domains.some((domain) => domain.searchEnabled) },
    { id: "nexus:activity", apiVersion: 1, title: "活动", route: "activity", icon: "≋", group: "home", order: 20, scope: "root", page: ActivityPage },
    { id: "nexus:review", apiVersion: 1, title: "待我处理", route: "review", icon: "◇", group: "home", order: 30, scope: "root", page: ReviewPage, badge: ({ data }) => data.drafts.filter((draft) => draft.state === "pending").length || undefined },
    { id: "nexus:memory", apiVersion: 1, title: "记忆", route: "memory", icon: "◌", group: "home", order: 40, scope: "root", page: MemoryPage },
    { id: "nexus:trust", apiVersion: 1, title: "信任中心", route: "trust", icon: "◉", group: "home", order: 50, scope: "root", page: TrustPage, badge: ({ data }) => data.trust.failed || undefined },
    { id: "nexus:apps", apiVersion: 1, title: "应用", route: "apps", icon: "▦", group: "home", order: 60, scope: "root", page: AppsPage }
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
