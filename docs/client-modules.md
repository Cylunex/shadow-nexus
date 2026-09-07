# Nexus client modules

> 2026-09-07 设计衔接：统一鉴权、Agent 与 Nexus 目标规范以 [本项目接入设计](nexus-integration-design.md) 为准。不再新增领域自管 OIDC/Session、Agent registry/Grant/审批中心或模型/工具通用循环；普通明确写入采用中央 current_intent。以下相关条目仅描述旧实现/历史阶段，不能作为新增实现继续复制；未迁移接口仍保留当前安全限制。

Shadow Nexus exposes a browser-side Cordis service named `shadowNexus`. Every page contribution, including the built-in modules, uses the same registration boundary.

```ts
export const inject = ["shadowNexus"];

export function apply(context: ClientContext): void {
  context.effect(() => context.shadowNexus.registerModule({
    id: "shadow-health:overview",
    apiVersion: 1,
    title: "Health",
    route: "health",
    icon: "H",
    group: "domains",
    order: 20,
    scope: "root",
    page: HealthPage
  }));
}
```

Rules:

- IDs contain a package namespace and are unique.
- Routes are unique, URL-safe single segments.
- Registration and disposal belong to a Cordis effect.
- `scope: "session"` modules are hidden until DSH has a current Session.
- `available` is a presentation filter, not an authorization decision.
- `badge` derives display-only state from the supplied Nexus projection.
- Page code receives the current Session ID, Sessions service, Nexus bootstrap projection, reload and navigation actions.
- Page code receives `ask(text, context)` to open the shared Agent dock with module/topic/range context; it must not dispatch directly into Conversation DOM.
- Every page is isolated by a module error boundary; retry remounts only that contribution.
- Modules do not edit Shell DOM, create root portals, or read credentials.

Future widget, command, settings, capture-handler, and review-renderer contracts will extend this service under a new explicit API version rather than changing version 1 silently.
