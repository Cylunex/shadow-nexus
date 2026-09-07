# Nexus 接入 Nexus 的详细设计

设计版本：2026-09-07 / UA-1。状态：目标设计，尚未实现。公共身份、鉴权、Agent、模型、命令与回执以 [Platform 统一规范](https://github.com/Cylunex/shadow-platform/blob/main/docs/nexus-unified-access-design.md) 为准；本文仅定义本领域差异。旧接口安全限制在对应能力通过迁移验收前继续生效。

## 1. 当前基线与模块归属

基线 `1019cbb`。`src/domains.ts` 按旧风险选择 Review create/commit 并返回字符串；`src/http.ts` 已自动执行 L0–L2，但在领域调用后持久化 JSON，异常进入复核。`src/proposals.ts` 对已 approved 的相同字段做语义合并。上述实现保留为迁移基线，不把 UI 删除当作闭环完成。

Nexus 保留工作台、当前 DSH 会话、意图提取、跨域上下文、Operation Journal 和通用 Surface Renderer。Agent loop 复用 DSH；工具发现/传输、auth client、确认、模型 client、公共预算和错误处理使用 Platform 组件。领域专用认证、凭据选择和批准策略不得继续加入 `domains.ts`。

## 2. 登录、意图和授权链

- 接入 Platform Session SDK；原 `confirmationActor()` 对回环代理头的识别不能作为新授权依据。Nexus 的 HTTP、流式会话、附件和后台重放都使用同一个中央 user_id。
- Nexus workload 只能登记其当前有效 Session 所属用户的真实 turn/表单提交。`intent_ref` 由 Access 返回，禁止模型提供 arbitrary owner、issuer、scope 或 Token。
- 主体权限不是“会话里谈到过这个领域”。注册意图保存 command/group/item、所选 capability、参数 hash、目标及有效时间；后台建议不会自动继承。
- 对具体实例/能力申请短时票据。新 Gateway/SDK 注入票据，模型、浏览器和领域返回值均不能选择调用地址或凭据；旧 per-domain env 仅供未迁移能力使用。
- 跨域结果只传下一步需要的字段；资源的读取许可与其结果向模型披露许可分别检查。

## 3. 运行时与命令接口

`DomainGateway` 演进为 `executeCommand(command, verifiedContext)`、`getOperationStatus(commandId)`、`readResult(ref)`。返回公共 Result，不再返回 Promise<string>。Runtime v2 从 Platform 同源 Schema 生成 TS 类型/validator，按 operation 宣告 effect/result/interaction/auth_mode；不能选整个领域的最高风险再套所有写入。

| 用户动作 | Host 行为 | 完成语义 |
| --- | --- | --- |
| 明确普通录入 | 验证字段/current_intent → execute | 领域 committed + 可关联实际资源 |
| 缺必需事实 | 保存未发送交互状态，问最关键缺项 | 不建立领域待审核积压 |
| 高影响动作 | 中央冻结参数/目标版本 → 当前卡片确认 → 同 command 执行 | Confirmation 与 Execution Receipt 分开 |
| 长任务 | 接收 accepted + task_ref，订阅/轮询状态 | 受理不计为已完成 |
| 多域录入 | group 内稳定 item ID，逐项保存与执行 | 部分完成可见，仅恢复未完成项 |
| 失败/超时 | 已知未提交才按策略重试；未知先 status | 不再统一显示“去审核页重试” |

旧 `receiptReference()` 和非 Review capture 的构造 URI 只可作诊断引用。缺领域成功证明时 reconciling；已证实提交但详情查询失败保留 committed。Archive ImportDraft、Garden publish、Health fact 的结果必须分别映射。

## 4. 状态、并发与数据归属

Journal 主键按 user_id + instance + command_id；包含 capability、operation、参数 hash、version、授权引用、source refs、状态与领域结果引用。prepared/executing 必须在网络写入前持久化；accepted 持续跟踪，reconciling 先查询，终态一旦可信不由旧异步返回覆盖。

JSON 单写者实现可以过渡，但必须通过崩溃/落盘/写队列失败恢复测试；不满足时改 SQLite，接口保持相同。需要恢复的参数保存在领域持久草案或短期加密 payload，不能只存 hash。旧 approved 但回执不可信的条目标记待核验，不在启动时重做 commit。

跨会话同 owner 只共享用户明确需要的事实引用；不同 owner 的 drafts、attachments、contexts、preferences、memory、suggestionFeedback、Today cache 必须分区。当前共享 Map 不能用 sessionId 参数过滤冒充账号隔离。权限/账号变化清除内存视图并使未发送旧意图失效。

幂等由一次真实提交的 command ID 决定；`sameProposal()` 只关联候选，不能吞掉第二次相同消费。用户修正生成新 command，携带原 receipt 和 expected_revision；原命令已未知时先核对，不边修正边重发。

## 5. 工具、页面和附件

普通 capture、quick-action、领域助手与系统分享通过同一 command service；旧 Review v1 仅是 adapter。中央工具目录根据 current user/delegation 裁剪，catalog_version 改变后刷新，不能以 UI 隐藏代替执行检查。

附件先保存 Asset/Version；Nexus 以中央 workload/用途票据建立指定领域引用委托，领域用自己的短时票据读取。会话附件不会默认分享全部领域；已撤销资源不得继续出现在模型 Context，临时视图与文件访问到期同步清理。

Today 初始最多 4 个并发域、单域和整体 timeout 可配置，缓存键包含主体/实例/权限版本/合同/查询；陈旧数据标时间、缺失不填零。Activity 只突出缺事实、冲突、未知和真实确认，完成项可合并但逐项 Receipt 可展开。Review 主导航在异常都能原位处理后移除。

## 6. 迁移拆分

1. 接入中央 Session/Auth client，锁定 Runtime/SDK 版本；单 owner 阶段显式拒绝不匹配身份。
2. 新增 Result/Journal/能力级路由，保留旧 mode；先用 Health weight 跑完整 current_intent。
3. 接入中央目录/确认/Model Gateway；DSH 原生 loop 不替换，各域 Token 不再交给模型宿主适配层自行选。
4. Ledger、Travel、Archive、Garden 按能力切换；403/428 或超时不 fallback 到旧路径。
5. App 队列贯通原 command ID/日期/账号；历史数据单独迁移，注销旧 auth/确认私钥配置。

## 7. 验收与退出条件

- 伪造 owner/Session/turn、跨实例 ticket、旧 catalog、回环伪造身份头均失败。
- 同命令并发/丢响应/重启只一条记录；不同命令相同字段两条；持久化失败不得先写领域。
- Garden 存草稿不发布，Archive 草稿不冒充正式归档；确认后参数修改拒绝。
- Access 故障/撤销不导致旧鉴权 fallback；已提交结果可在恢复权限后核对。
- 跨日离线仍保留原日期，旧账号队列/附件不能被新账号读取；长任务仅 accepted 时不清队列。
- 修改 `src/domains.ts/http.ts/contracts.ts/projection.ts/proposals.ts/client/*` 时同步对应 tests；本次仅设计，未执行未来测试。
