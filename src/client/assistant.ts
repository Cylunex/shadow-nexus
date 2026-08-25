import { type ISessions, type SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type { CaptureDraft } from "../contracts.js";
import { nexusEndpoint, nexusJson } from "./api.js";
import type { NexusAskContext } from "./contracts.js";

function sessionFace(sessions: ISessions, sessionId: string) {
  const scope = sessions.scope(sessionId as SessionId);
  const face = scope === undefined ? undefined : sessions.sessionOf(scope);
  if (face === undefined) throw new Error("当前 DSH 会话尚未就绪。");
  return face;
}

export async function askNexus(
  sessions: ISessions,
  sessionId: string,
  text: string,
  context: NexusAskContext
): Promise<void> {
  const original = text.trim();
  if (original === "") throw new Error("问题不能为空。");
  const pageContext = [
    `页面模块：${context.module}`,
    context.topic === undefined ? undefined : `讨论主题：${context.topic}`,
    context.range === undefined ? undefined : `时间范围：${context.range}`
  ].filter((line): line is string => line !== undefined).join("\n");
  const prompt = `[Shadow Nexus · Ask]\n这是普通交流和只读分析请求，不是新增记录。除非用户明确切换到“记一下”并完成 Review，否则不要创建或修改任何领域事实。\n${pageContext}\n\n用户问题：\n${original}`;
  const accepted = await sessionFace(sessions, sessionId).prompt([{ type: "text", text: prompt }], "queue");
  if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
}

export async function captureNexus(sessions: ISessions, sessionId: string, text: string): Promise<CaptureDraft> {
  const original = text.trim();
  if (original === "") throw new Error("记录内容不能为空。");
  const prompt = `[Shadow Nexus · Capture]\n请保留下面的原始信息并帮助理解；在用户于 Review 确认前，不要调用任何领域写入工具。\n\n${original}`;
  const accepted = await sessionFace(sessions, sessionId).prompt([{ type: "text", text: prompt }], "queue");
  if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
  return nexusJson<CaptureDraft>(await fetch(nexusEndpoint("capture", sessionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text: original })
  }));
}
