# Nexus client modules

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
