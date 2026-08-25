import type { SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import { useCallback, useState } from "react";
import type { CaptureDraft, DomainId, DomainSummary, TodaySignal } from "../contracts.js";
import { captureNexus } from "./assistant.js";
import { nexusEndpoint, nexusJson } from "./api.js";
import type { NexusModuleDescriptor, NexusPageProps } from "./contracts.js";

function StatusDot({ status }: { readonly status: DomainSummary["status"] }) {
  return <span className="sn-status" data-status={status} title={status} />;
}

function DomainMark({ domain }: { readonly domain: DomainId }) {
  const marks: Record<DomainId, string> = { health: "H", ledger: "L", travel: "T", archive: "A", foliant: "F" };
  return <span className="sn-domain-mark" data-domain={domain}>{marks[domain]}</span>;
}

const fieldLabels: Readonly<Record<string, string>> = {
  source: "来源",
  effectiveDate: "生效日期",
  occurredAt: "发生时间",
  timezone: "时区",
  recordType: "记录类型",
  weightKg: "体重",
  sleepHours: "睡眠",
  moodScore: "情绪评分",
  distanceKm: "距离",
  durationMin: "时长",
  rpe: "运动强度",
  meal: "餐次",
  mealName: "内容",
  amountG: "总重量",
  kcal: "热量",
  proteinG: "蛋白质",
  amount: "金额",
  currency: "币种",
  moneyType: "收支类型",
  merchant: "商家",
  categoryKey: "分类",
  title: "标题"
};

const fieldValueLabels: Readonly<Record<string, string>> = {
  metric: "身体指标",
  meal: "饮食",
  workout: "运动",
  expense: "支出",
  income: "收入",
  refund: "退款",
  "shadow-nexus": "Nexus 采集",
  food: "餐饮",
  shopping: "购物",
  transport: "交通",
  housing: "居住",
  services: "生活服务",
  entertainment: "娱乐",
  travel: "旅行",
  health: "健康",
  subscription: "订阅",
  other: "其他"
};

function displayFieldValue(key: string, value: string): string {
  if (key === "weightKg") return `${value} kg`;
  if (key === "sleepHours") return `${value} 小时`;
  if (key === "distanceKm") return `${value} km`;
  if (key === "durationMin") return `${value} 分钟`;
  if (key === "amountG" || key === "proteinG") return `${value} g`;
  if (key === "kcal") return `${value} kcal`;
  if (key === "amount") return `¥${value}`;
  return fieldValueLabels[value] ?? value;
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
      await captureNexus(sessions, sessionId, text);
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
    <header className="sn-page-header"><span>CAPTURE</span><h1>先记下来，归属可以稍后决定。</h1><p>Shadow 会把原文保留在当前 DSH 会话，并生成结构化 Proposal 供你确认；图片和文件可从底部“＋”统一上传。</p></header>
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

function DraftCard({ draft, sourceTitle, target, siblingCount, reload }: {
  readonly draft: CaptureDraft;
  readonly sourceTitle: string;
  readonly target: DomainSummary | undefined;
  readonly siblingCount: number;
  readonly reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const connectedTarget = (draft.domain === "health" || draft.domain === "ledger") && target?.status === "ready";
  const targetLabel = target?.label ?? draft.domain;
  const submittedKeys = draft.domain === "health"
    ? ["recordType", "weightKg", "sleepHours", "moodScore", "distanceKm", "durationMin", "rpe", "meal", "mealName", "amountG", "kcal", "proteinG"]
    : draft.domain === "ledger"
      ? ["moneyType", "amount", "currency", "categoryKey", "title"]
      : [];
  const visibleFields: readonly (readonly [string, string])[] = [
    ...(draft.domain === "health" ? [["effectiveDate", draft.fields.effectiveDate ?? new Date(draft.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })] as const] : []),
    ...(draft.domain === "ledger" ? [
      ["occurredAt", draft.fields.occurredAt ?? new Date(draft.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })] as const,
      ["timezone", "Asia/Shanghai"] as const
    ] : []),
    ...submittedKeys.flatMap((key): readonly (readonly [string, string])[] => draft.fields[key] === undefined ? [] : [[key, draft.fields[key]]])
  ];
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await nexusJson<CaptureDraft>(await fetch(nexusEndpoint("review", draft.sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: draft.sessionId, draftId: draft.id, decision })
      }));
      setError(undefined);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理草稿失败。");
    } finally { setBusy(false); }
  }
  return <article className="sn-draft">
    <header><DomainMark domain={draft.domain} /><div><span>{draft.intent}</span><time>{new Date(draft.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 来源：{sourceTitle}</time></div><em data-risk={draft.risk}>{draft.risk === "low" ? "低风险" : draft.risk === "medium" ? "需确认" : "高风险"}</em></header>
    <h3>{draft.summary}</h3>
    <div className="sn-draft-target" data-ready={connectedTarget}>
      <DomainMark domain={draft.domain} />
      <p><strong>{connectedTarget ? `将提交到 ${targetLabel}` : `${targetLabel} 暂不可提交`}</strong><span>{connectedTarget ? draft.origin === "domain" ? `这是 ${targetLabel} 已有的 Agent 草稿；Nexus 只集中审核，确认时直接提交原草稿，不会重复创建。` : draft.domain === "health" ? "你在这里确认后，Nexus 会先创建可审计的 Health 草稿，再立即写成正式健康记录；无需到 Health 二次确认。" : "你在这里确认后，Nexus 会先创建可审计的 Ledger 草稿，再提交同一条记录正式入账；原文继续留在 Nexus。" : draft.domain === "health" || draft.domain === "ledger" ? "领域连接当前不可用，请恢复连接后再确认。" : "这个领域尚未接入 Nexus 写入适配器。"}</span></p>
    </div>
    {siblingCount > 1 && <p className="sn-draft-group">同一次记录已拆成 {siblingCount} 张领域草稿，请分别核对和确认。</p>}
    <section className="sn-draft-fields"><h4>将提交的字段</h4><dl>{visibleFields.map(([key, value]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{displayFieldValue(key, value)}</dd></div>)}</dl></section>
    <details className="sn-draft-source"><summary>查看完整原文 <span>{draft.text.length} 字 · 可拖动右下角放大</span></summary><pre>{draft.text}</pre></details>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={() => { void decide("reject"); }}>退回</button><button className="sn-primary" type="button" disabled={busy || !connectedTarget} title={connectedTarget ? undefined : "目标领域尚未连接或未接入"} onClick={() => { void decide("approve"); }}>{connectedTarget ? draft.domain === "health" || draft.domain === "ledger" ? `确认并写入 ${targetLabel}` : `提交 ${targetLabel} 草稿` : "暂不可提交"}</button></footer>
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
  const confirmable = drafts.every((draft) => (draft.domain === "health" || draft.domain === "ledger") && domains.find((domain) => domain.id === draft.domain)?.status === "ready");
  const ledgerTotal = drafts.reduce((total, draft) => draft.domain === "ledger" && draft.fields.moneyType === "expense" ? total + Number(draft.fields.amount ?? 0) : total, 0);
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
    <header><div><span>{title}</span><h2>{drafts.length} 条待确认{ledgerTotal > 0 ? ` · 支出合计 ¥${ledgerTotal.toFixed(2)}` : ""}</h2><p>逐条展开核对，也可以整组确认或退回；批量处理会逐条保存进度。</p></div><div><button type="button" disabled={busy} onClick={() => { void decideAll("reject"); }}>整组退回</button><button className="sn-primary" type="button" disabled={busy || !confirmable} title={confirmable ? undefined : "组内有尚未接入或离线的领域"} onClick={() => { void decideAll("approve"); }}>整组确认</button></div></header>
    {error !== undefined && <p className="sn-error">{error}</p>}
    <div className="sn-draft-list">{drafts.map((draft) => <DraftCard key={draft.id} draft={draft} sourceTitle={sourceTitle(draft)} target={domains.find((domain) => domain.id === draft.domain)} siblingCount={drafts.length} reload={reload} />)}</div>
  </section>;
}

export function ReviewPage({ data, sessions, reload }: NexusPageProps) {
  const pending = data.drafts.filter((draft) => draft.state === "pending");
  const settled = data.drafts.filter((draft) => draft.state !== "pending");
  const summaries = sessions.list.getSnapshot().byId;
  const sourceTitle = (draft: CaptureDraft) => draft.sessionId.startsWith("domain:health")
    ? "Health Agent 草稿"
    : draft.sessionId === "domain:ledger"
      ? "Ledger Agent 草稿"
      : summaries[draft.sessionId as SessionId]?.displayTitle ?? draft.sessionId;
  const groups = [...pending.reduce((result, draft) => {
    const key = draft.captureGroupId ?? draft.id;
    result.set(key, [...(result.get(key) ?? []), draft]);
    return result;
  }, new Map<string, CaptureDraft[]>()).values()];
  return <div className="sn-page sn-review-page">
    <header className="sn-page-header"><span>REVIEW / CONTROL PLANE</span><h1>所有草稿，都先在这里确认。</h1><p>Nexus 汇总各会话 Proposal 和领域 Agent 草稿；数据仍归 Health、Ledger 所有，确认前不会成为正式事实。</p></header>
    {pending.length === 0 ? <div className="sn-empty"><span>◇</span><h2>暂时没有待确认项</h2><p>从底部“记一下”开始，或等待领域 Agent 草稿同步到这里。</p></div> : groups.map((drafts) => drafts.length > 1
      ? <DraftGroup key={drafts[0]?.captureGroupId ?? drafts[0]?.id} drafts={drafts} sourceTitle={sourceTitle} domains={data.domains} reload={reload} />
      : drafts[0] === undefined ? null : <div className="sn-draft-list" key={drafts[0].id}><DraftCard draft={drafts[0]} sourceTitle={sourceTitle(drafts[0])} target={data.domains.find((domain) => domain.id === drafts[0]?.domain)} siblingCount={1} reload={reload} /></div>)}
    {settled.length > 0 && <section className="sn-history"><h2>全局已处理</h2>{settled.map((draft) => <p key={draft.id}><DomainMark domain={draft.domain} /><span>{draft.summary}</span><em data-state={draft.state}>{draft.state === "approved" ? draft.domain === "health" || draft.domain === "ledger" ? `已写入 ${draft.domain === "health" ? "Health" : "Ledger"}` : "领域草稿已创建" : "已退回"}</em></p>)}</section>}
  </div>;
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
      const question = domainId === "health" ? "分析一下我最近 30 天的体重变化，并说明长期趋势和短期波动。" : `结合已有数据，和我聊聊 ${domainLabel} 最近值得关注的变化。`;
      await ask(question, { module: domainId, topic: domainId === "health" ? "weight" : "overview", range: "30d" });
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
    <div className="sn-domain-columns"><section><span>事实边界</span><h2>数据留在 {domain.label}</h2><p>Nexus 只读取允许暴露的摘要、待办和跨域引用，不复制领域事实表。</p></section><section><span>会话协作</span><h2>{domainId === "health" ? "聊聊最近的体重变化" : "让 Shadow 继续处理"}</h2><p>{domainId === "health" ? "保持当前页面，在右侧对话中读取趋势并继续追问。" : "在右侧对话中结合这个领域的页面上下文继续交流。"}</p><div className="sn-domain-actions"><button type="button" disabled={asking} onClick={() => { void discuss(); }}>{asking ? "正在打开…" : domainId === "health" ? "聊聊 30 天体重变化" : "聊聊这个领域"}</button><button type="button" onClick={showConversation}>展开完整对话</button></div>{askError !== undefined && <p className="sn-error">{askError}</p>}</section></div>
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
