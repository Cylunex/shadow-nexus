import type { DomainSummary } from "./contracts.js";

function installed(domains: readonly DomainSummary[], id: string): boolean {
  return domains.some((domain) => domain.id === id && domain.captureEnabled);
}

/** Business-preservation guidance shared by conversation and batch capture. */
export function buildNexusProcessingRules(domains: readonly DomainSummary[], mode: "interaction" | "capture" = "interaction"): string {
  const rules = [
    "完整性：输出前逐项检查用户明确要保存的事实；一次请求可跨领域或同领域拆分，不能只处理一项，也不能把说明性数字擅自记录。",
    mode === "interaction"
      ? "少追问：缺可选字段时保留部分事实，不追问也不再次确认 L0–L2。若一项缺必填字段但其他项完整，route=mixed，先生成完整 Proposal，response 只追问剩余一项；没有完整事实才 route=clarify、drafts=[]。"
      : "批量保真：缺可选字段时保留部分事实；缺必填字段的事实不得编造或阻断其他完整 Proposal。",
    "原话保真：保留日期、生活化数量单位、商家、地点、渠道和备注；相对日期按会话时区解析。没有证据的金额、重量、营养、账户或分类不得猜测；有备注字段时，份量、做法、已吃一部分和别名解释写备注，不塞进主体名称。",
    "命名惯例：“常规早餐”等模板只在授权只读工具可解析时展开，否则保留别名，不编造明细。"
  ];

  if (mode === "interaction") {
    rules.push("完成语义：response 只说明理解结果；领域 Host 返回正式回执前不得说“已记录”“已入账”或“已保存”。");
  }

  if (installed(domains, "health")) {
    rules.push("Health：食物名称保持干净，个/把/根/碗和“已吃一点”等写 notes；除非用户提供或只读工具返回，不从照片或份量估算 amount_g、kcal 或三大营养素。实际食物照片可关联 Health。");
  }
  if (installed(domains, "ledger")) {
    rules.push("Ledger：记录请求含订单、账单、实付金额、商家、地点或支付渠道时，单独检查 ledger 收支 Proposal，不能因同时记录饮食而漏账。保留合同支持的消费元数据；金额不臆造。订单图有追溯价值才关联，结构化事实足够时可不留图。");
  }
  if (installed(domains, "health") && installed(domains, "ledger")) {
    rules.push("Health × Ledger：外卖可同时产生饮食和消费两类 Proposal。食物实拍默认给 Health，订单/支付图默认给 Ledger；同一图直接证明两类事实且都值得保留时才双向引用。");
  }

  return rules.map((rule, index) => `${String(index + 1)}. ${rule}`).join("\n");
}
