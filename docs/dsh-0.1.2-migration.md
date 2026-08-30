# DSH 0.1.2 migration assessment

Assessment date: 2026-08-30

## Decision

Keep Shadow Nexus on the published DSH `0.1.1-rc.2` package set for now. The official repository has the
source tag `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`, but the corresponding
packages are not available from the official npm registry. The alpha contains 1,079 commits after rc.2 and
is a migration, not a dependency-only upgrade.

Do not mix rc.2 and alpha packages. Start the migration only when one complete, installable DSH package
family is published, then pin every DSH package to the same exact version.

## Improvements worth adopting

- Browser Host APIs gain launch-token to signed `HttpOnly` session-cookie authentication.
- Client state is split into explicit Session and Workspace controllers plus small React adapters.
- Conversation assembly becomes target-neutral and incremental; Chat is an independent target with a
  compatibility projection for nodes and completed turns.
- The composer uses optimistic submission echo and a Lexical-based editor with reference chips.
- The stock UI adds compact turn navigation, historical image rendering, adaptive content width, and font
  size settings.
- Session history reads fail closed on unknown event types instead of silently interpreting a newer log.

## Required Nexus adaptations

1. Replace `@deepseek-ai/dsh-client-runtime` imports. `ISessions` and `SessionFace` move to
   `@deepseek-ai/dsh-api-session-controller/client`; `SessionId` moves to `@deepseek-ai/dsh-session/types`;
   the client apply context is the Cordis `Context`.
2. Add explicit client dependencies/injection for Session Controller, UI Session, UI Renderer,
   UI Conversation, and UI Chat. The deleted monolithic runtime no longer installs these transitively.
3. Replace `sessions.scope()` plus `sessions.sessionOf()` with `sessions.binding(sessionId)?.session`.
4. Replace `SessionFace.getSnapshot().nodes` reads. Session snapshots now contain lifecycle/control state,
   while Chat nodes live in
   `ctx.uiConversation.binding(sessionId).target("chat").getSnapshot()?.legacy`. Nexus should inject a
   narrow conversation-reader adapter rather than depend on Chat internals throughout the UI.
5. Update `SessionProvider` usage: alpha accepts a React node as `children`, not a render callback.
6. Rebuild the root-slot topology test against the alpha Slot registry and verify that disabling
   `ui-layout` still leaves Nexus as the only `root` occupant while official Sidebar, Conversation,
   Details, and overlays remain mounted exactly once.
7. Add browser-auth smoke tests for HTTP, WebSocket, plugin assets, Nexus routes, and reverse-proxy identity
   headers. The new DSH browser cookie must coexist with Shadow Identity without creating an unauthenticated
   alternate route.
8. Re-run native profile smoke tests for prompt completion detection, optimistic echo deduplication,
   Session switching, dock/full Conversation continuity, and HMR disposal.

## Upgrade gate

Upgrade only when all of the following are true:

- the official npm registry exposes the complete exact-version package closure;
- a clean lockfile install succeeds on the supported Node version;
- typecheck, unit tests, production build, and root-slot topology tests pass;
- a stock DSH Web profile and the Shadow profile both pass native browser smoke tests;
- browser authentication, reverse-proxy authentication, and WebSocket upgrades pass positive and negative
  cases; and
- the current rc.2 release remains available as an atomic rollback.
