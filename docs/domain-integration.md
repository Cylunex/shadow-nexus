# Domain integration

Nexus 是通用工作台，不拥有领域注册表，也不理解领域字段。接入一个新领域时，只修改领域仓库
的 Plugin Definition 和仓库外 Deployment；不修改 `src/domains.ts`、页面导航或关键词路由。

## 唯一装配链路

```text
domain repository
├── shadow-plugin.yaml
├── agent/manifest.yaml
├── contracts/agent.openapi.yaml
└── contracts/surfaces.yaml
              │
              ▼
Shadow Platform Profile Compiler
              │
              ▼
shadow-nexus-runtime.json
              │
              ▼
Nexus Generic Host + Generic Surface Renderer
```

Nexus 只从 `SHADOW_NEXUS_RUNTIME_FILE` 加载经过 Platform 编译的投影。投影声明领域展示信息、
连接所需环境变量名、Summary/Capture/Review/Search/App Link Surface 和对应 HTTP Operation。真实
地址与 Bearer 仍来自 Host 环境，绝不进入浏览器或 Git。

没有 Runtime 文件时，Nexus 进入明确的 unconfigured 状态，不恢复到内置 Health/Ledger 清单。
某个领域地址或凭据缺失时，该领域显示 unavailable/degraded，其他领域仍可工作。

## 通用 Surface

当前运行时支持：

- `summary`：只读卡片，使用声明式 JSON Pointer 取展示值；
- `capture`：把 DSH 产出的结构化 Proposal 发送到领域 Draft；
- `review`：发现、确认或拒绝领域拥有的待审核对象；
- `search`：声明 `collection_pointer` 和 `item_title_pointer`，可选声明结果摘要及稳定引用指针，由 Nexus 联合检索；
- `run-status`、`resource-link`、`app-link`：作为动态模块或资源入口；
- `shadow.review.v1`：跨领域审核协议。

Surface 只描述数据投影，不允许加载远程 JavaScript。需要定制交互时，领域提供受信任的 DSH
Client Plugin，并通过 `ctx.shadowNexus.registerModule()` 注册；卸载时必须随 Cordis effect 清理。

## 标准审核协议

需要正式写入的领域由自己实现：

```text
POST /nexus/reviews
GET  /nexus/reviews
POST /nexus/reviews/{review_id}/commit
POST /nexus/reviews/{review_id}/reject
```

具体路径可以不同，由 OpenAPI Operation 投影决定。统一响应至少包含：

```json
{
  "protocol": "shadow.review.v1",
  "review_id": "opaque-domain-id",
  "reference": "shadow://domain/drafts/opaque-domain-id",
  "revision": 1,
  "domain": "domain",
  "intent": "domain.record",
  "summary": "等待确认的内容",
  "fields": {},
  "risk_level": "L2",
  "state": "pending",
  "created_at": "2026-08-26T00:00:00Z",
  "source_refs": [],
  "trace_id": "trace-id",
  "receipt": null,
  "replayed": false
}
```

领域负责 Agent audience/scope、资源级 grant、幂等、Revision、业务校验、审计和最终事实写入。
Nexus 只保存 Proposal 状态和领域引用。确认已有领域草稿时必须提交同一个 `review_id`；重复确认
返回 replay，不重复创建事实。用户拒绝后由领域完成可恢复撤销或记录拒绝审计。

L3/L4 操作还要求短时 `ConfirmationReceipt`。Nexus 只在受保护请求具有可信 actor 时签发，并
绑定投影中的 plugin/capability/tool/effect、规范参数摘要与资源 URI；领域服务验签并原子消费
nonce。提示词、按钮或 DSH Approval 本身都不是领域写权限。

## Capture 路由

正式 Capture 只接受当前 DSH Session 返回的 `NexusIntentPlan`。Nexus 不再维护本地关键词表，
也不猜测 `travel`、`archive` 等领域语义。计划中的每个 Proposal 必须指向 Runtime 已安装领域；
否则整体分析结果被拒绝。模型 Profile 只暴露读取/分析能力，写操作由隐藏 Host Adapter 在用户
确认后执行。

## 完成标准

一个领域接入完成至少满足：

1. Platform 校验 Definition、Manifest、OpenAPI 与 Surface；
2. 同一 Deployment 能生成 DSH、Nexus、App 投影和 Lock；
3. 增删该领域不需要修改 Nexus 核心；
4. Summary/Capture/Review 的成功、401/403、超时、无凭据和坏响应均有测试；
5. Draft 创建、确认、拒绝和重试保持幂等；
6. 所有最终结果返回 `shadow://` 引用与 trace；
7. Runtime 版本不兼容在激活前失败，旧 Release 可原子回滚。

Health 与 Ledger 是标准协议的 Golden Fixtures；Travel 验证第三领域零核心修改接入；Archive
首期使用 Search/Capture-only；Garden 的发布执行属于 L3，必须使用签名确认。Foliant、Verse、
Wingman 不在当前实现范围。
