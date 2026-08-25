import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { NexusAssetAttachment, NexusAssetUploadInit, NexusAssetUploadTicket } from "./contracts.js";

const CONTROL_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

interface AssetUploadTarget {
  readonly method: "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface PendingUpload {
  readonly ticketId: string;
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly referenceUri: string;
  readonly uploadSessionId: string;
  readonly target: AssetUploadTarget;
  readonly temporaryPath: string;
  readonly conversationPath: string;
  uploaded: boolean;
}

export class AssetGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface AssetGateway {
  readonly configured: boolean;
  initUpload(input: NexusAssetUploadInit): Promise<NexusAssetUploadTicket>;
  uploadContent(ticketId: string, source: AsyncIterable<Uint8Array>): Promise<void>;
  completeUpload(ticketId: string): Promise<NexusAssetAttachment>;
}

export interface HttpAssetGatewayConfig {
  readonly baseUrl: string;
  readonly serviceTokenFile: string;
  readonly ownerId: string;
  readonly conversationRoot: string;
  readonly fetch?: typeof fetch;
}

function cleanEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function safeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AssetGatewayError(500, "Asset 服务地址无效。"); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new AssetGatewayError(500, "Asset 服务地址无效。");
  }
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new AssetGatewayError(500, "Asset 服务必须使用 HTTPS 或本机回环地址。");
  }
  return value.replace(/\/+$/u, "");
}

export function sanitizeAssetFilename(value: string): string {
  const normalized = basename(value.replace(/\\/gu, "/")).normalize("NFKC");
  const printable = [...normalized].filter((character) => !/[\p{Cc}\p{Cf}]/u.test(character)).join("").trim();
  const safe = printable === "" || printable === "." || printable === ".." ? "asset" : printable;
  return [...safe].slice(0, 180).join("");
}

function contentType(value: string): string {
  const normalized = value.split(";", 1)[0]?.trim().toLocaleLowerCase() ?? "";
  return normalized === "" ? "application/octet-stream" : normalized;
}

function sessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function referenceUri(sessionId: string, attachmentId: string): string {
  return `shadow://nexus/conversations/${sessionKey(sessionId)}/attachments/${attachmentId}`;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new AssetGatewayError(502, "Asset 服务返回了无效响应。"); }
  if (!response.ok) {
    const detail = typeof value === "object" && value !== null && "detail" in value
      ? String((value as { readonly detail?: unknown }).detail ?? "")
      : "";
    throw new AssetGatewayError(response.status === 413 ? 413 : response.status >= 500 ? 503 : 422, detail || "Asset 服务拒绝了请求。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AssetGatewayError(502, "Asset 服务返回了无效响应。");
  return value as Record<string, unknown>;
}

async function removeIfPresent(path: string): Promise<void> {
  try { await unlink(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("写入附件失败。");
    offset += bytesWritten;
  }
}

export class HttpAssetGateway implements AssetGateway {
  readonly configured = true;
  private readonly baseUrl: string;
  private readonly conversationRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pending = new Map<string, PendingUpload>();

  constructor(private readonly config: HttpAssetGatewayConfig) {
    this.baseUrl = safeBaseUrl(config.baseUrl);
    this.conversationRoot = resolve(config.conversationRoot);
    this.fetchImpl = config.fetch ?? fetch;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(config.ownerId)) {
      throw new AssetGatewayError(500, "Asset owner 标识无效。");
    }
  }

  private async token(): Promise<string> {
    let token: string;
    try { token = (await readFile(this.config.serviceTokenFile, "utf8")).trim(); }
    catch { throw new AssetGatewayError(503, "Asset 服务凭据不可用。"); }
    if (token === "") throw new AssetGatewayError(503, "Asset 服务凭据不可用。");
    return token;
  }

  private async control(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          accept: "application/json",
          ...init.headers
        },
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS)
      });
    } catch (error) {
      if (error instanceof AssetGatewayError) throw error;
      throw new AssetGatewayError(503, "Asset 服务暂时不可用。");
    }
    return responseJson(response);
  }

  async initUpload(input: NexusAssetUploadInit): Promise<NexusAssetUploadTicket> {
    const sessionId = input.sessionId.trim();
    if (sessionId === "" || sessionId.length > 256) throw new AssetGatewayError(400, "sessionId 无效。");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new AssetGatewayError(400, "附件大小无效。");
    const filename = sanitizeAssetFilename(input.filename);
    const mediaType = contentType(input.contentType);
    const attachmentId = randomUUID();
    const ticketId = randomUUID();
    const reference = referenceUri(sessionId, attachmentId);
    const value = await this.control("/v1/upload-sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `nexus:${attachmentId}` },
      body: JSON.stringify({
        owner_id: this.config.ownerId,
        ownership_mode: "user_owned",
        access_mode: "private",
        sensitivity: "normal",
        retention_policy_key: "nexus-conversation",
        display_name: filename,
        original_filename: filename,
        content_type: mediaType,
        size_bytes: input.sizeBytes,
        initial_reference: {
          resource_uri: reference,
          usage_role: "conversation.attachment",
          reference_key: `nexus:${sessionKey(sessionId)}:${attachmentId}`,
          binding_mode: "pinned"
        }
      })
    });
    const uploadSessionId = value.upload_session_id;
    const target = value.target;
    if (typeof uploadSessionId !== "string" || typeof target !== "object" || target === null || Array.isArray(target)) {
      throw new AssetGatewayError(502, "Asset 服务返回了无效上传目标。");
    }
    const targetValue = target as Partial<AssetUploadTarget>;
    if (targetValue.method !== "PUT" || typeof targetValue.url !== "string" || typeof targetValue.headers !== "object" || targetValue.headers === null) {
      throw new AssetGatewayError(502, "Asset 服务返回了无效上传目标。");
    }
    safeBaseUrl(targetValue.url);
    const directory = join(this.conversationRoot, sessionKey(sessionId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fileComponent = `${attachmentId}-${filename}`;
    const pending: PendingUpload = {
      ticketId,
      attachmentId,
      sessionId,
      filename,
      contentType: mediaType,
      sizeBytes: input.sizeBytes,
      referenceUri: reference,
      uploadSessionId,
      target: { method: "PUT", url: targetValue.url, headers: { ...targetValue.headers } as Record<string, string> },
      temporaryPath: join(directory, `.${fileComponent}.pending`),
      conversationPath: join(directory, fileComponent),
      uploaded: false
    };
    this.pending.set(ticketId, pending);
    return { ticketId, attachmentId, filename, contentType: mediaType, sizeBytes: input.sizeBytes };
  }

  async uploadContent(ticketId: string, source: AsyncIterable<Uint8Array>): Promise<void> {
    const pending = this.pending.get(ticketId);
    if (pending === undefined) throw new AssetGatewayError(404, "上传会话不存在或已经过期。");
    if (pending.uploaded) return;
    await removeIfPresent(pending.temporaryPath);
    const handle = await open(pending.temporaryPath, "wx", 0o600);
    let bytes = 0;
    try {
      for await (const chunk of source) {
        const value = Buffer.from(chunk);
        bytes += value.byteLength;
        if (bytes > pending.sizeBytes) throw new AssetGatewayError(413, "附件大小超过声明值。");
        await writeAll(handle, value);
      }
      if (bytes !== pending.sizeBytes) throw new AssetGatewayError(400, "附件大小与声明值不一致。");
    } catch (error) {
      await handle.close();
      await removeIfPresent(pending.temporaryPath);
      throw error;
    }
    await handle.close();

    let response: Response;
    try {
      const body = Readable.toWeb(createReadStream(pending.temporaryPath)) as ReadableStream<Uint8Array>;
      const init = {
        method: pending.target.method,
        headers: pending.target.headers,
        body,
        duplex: "half",
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
      } as RequestInit & { readonly duplex: "half" };
      response = await this.fetchImpl(pending.target.url, init);
    } catch {
      await removeIfPresent(pending.temporaryPath);
      throw new AssetGatewayError(503, "附件上传到 Asset 失败。");
    }
    if (!response.ok) {
      await removeIfPresent(pending.temporaryPath);
      throw new AssetGatewayError(response.status === 413 ? 413 : 502, "附件上传到 Asset 失败。");
    }
    pending.uploaded = true;
  }

  async completeUpload(ticketId: string): Promise<NexusAssetAttachment> {
    const pending = this.pending.get(ticketId);
    if (pending === undefined) throw new AssetGatewayError(404, "上传会话不存在或已经过期。");
    if (!pending.uploaded) throw new AssetGatewayError(409, "附件内容尚未上传完成。");
    const value = await this.control(`/v1/upload-sessions/${encodeURIComponent(pending.uploadSessionId)}/complete`, { method: "POST" });
    const assetId = value.id;
    const versionId = value.current_version_id;
    if (typeof assetId !== "string" || typeof versionId !== "string") throw new AssetGatewayError(502, "Asset 服务返回了无效资产。");
    await chmod(pending.temporaryPath, 0o400);
    await rename(pending.temporaryPath, pending.conversationPath);
    this.pending.delete(ticketId);
    return {
      id: pending.attachmentId,
      sessionId: pending.sessionId,
      assetId,
      versionId,
      referenceUri: pending.referenceUri,
      conversationPath: pending.conversationPath,
      filename: pending.filename,
      contentType: pending.contentType,
      sizeBytes: pending.sizeBytes,
      createdAt: new Date().toISOString()
    };
  }
}

class DisabledAssetGateway implements AssetGateway {
  readonly configured = false;
  initUpload(): Promise<NexusAssetUploadTicket> { return Promise.reject(new AssetGatewayError(503, "Shadow Asset 尚未连接。")); }
  uploadContent(): Promise<void> { return Promise.reject(new AssetGatewayError(503, "Shadow Asset 尚未连接。")); }
  completeUpload(): Promise<NexusAssetAttachment> { return Promise.reject(new AssetGatewayError(503, "Shadow Asset 尚未连接。")); }
}

export function createAssetGateway(): AssetGateway {
  const baseUrl = cleanEnvironment("SHADOW_ASSET_BASE_URL");
  const serviceTokenFile = cleanEnvironment("SHADOW_ASSET_SERVICE_TOKEN_FILE");
  const ownerId = cleanEnvironment("SHADOW_ASSET_OWNER_ID");
  if (baseUrl === undefined || serviceTokenFile === undefined || ownerId === undefined) return new DisabledAssetGateway();
  return new HttpAssetGateway({
    baseUrl,
    serviceTokenFile,
    ownerId,
    conversationRoot: cleanEnvironment("SHADOW_NEXUS_ASSET_VIEW_ROOT") ?? resolve(process.cwd(), ".shadow-nexus", "assets")
  });
}
