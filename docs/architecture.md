# Shadow Nexus architecture

Shadow Nexus is the Shadow-facing root Web shell over DSH Runtime. It owns presentation and navigation, not domain facts or the Agent loop.

## Runtime shape

```text
DSH UI Renderer
└── Shadow Nexus root
    ├── Nexus workbench + visible current Session
    ├── official Conversation (right dock or full screen)
    ├── official Sidebar (full Conversation mode)
    ├── official Details
    └── shared overlays
          │ same current Session + HTTP projection
          ▼
Shadow Nexus host plugin
├── capture queue and review policy
├── cross-domain read model
└── compiled runtime projection
          │ signed machine calls
          ▼
independently deployed Shadow domains
```

The Host and Browser halves ship as one DSH plugin. In the dedicated Shadow profile, the bundle disables official `ui-layout`; Nexus becomes the only `root` occupant and declares the `sidebar`, `conversation`, `details`, and `shell.overlay` child slots. It also provides the small `layout` service consumed by official Conversation and projects the upstream theme onto the document. Conversation is mounted exactly once and changes geometry between hidden, right-dock, and full-screen states, so streaming, composer drafts, tools and scroll state survive transitions. The current DSH Session is the interaction and context source; its real title and selector remain visible in the workbench. Each domain application remains the structured fact source and the only component allowed to commit its facts.

The stock `web` profile must remain available without the Nexus bundle. Root ownership is a composition boundary and is not hot-swapped inside a running renderer.

## Browser navigation and modules

The query parameters `surface` and `view` are the durable browser navigation state. Nexus defaults to `surface=nexus` and `view=today`; browser back/forward and refresh preserve explicit selections. DSH remains the sole owner of current Session selection. The workbench currently follows that selection explicitly and labels the policy instead of silently borrowing the last Session.

Nexus provides the `ctx.shadowNexus.registerModule()` service. Built-in Now, Search, Review, Apps, and projected domain pages use the same versioned registration contract as external client plugins. Search fans out only to declared Search Surfaces and renders their generic item projection; Apps opens the Catalog-projected domain application and does not duplicate its full UI as a native Nexus page. Registrations have namespaced IDs, unique routes, deterministic ordering, availability and badge hooks, and effect-scoped disposal. A removed active module falls back to Now.

Installed domain UI code must enter through a trusted DSH Client plugin. A domain manifest may describe a Surface but never names remotely executed JavaScript.

## Authentication boundary

Nexus does not implement a second login inside DSH. The dedicated public Nexus origin must protect the
entire DSH surface (HTML, plugin assets, HTTP APIs, and WebSockets) with Shadow Identity at the reverse
proxy, while the DSH upstream listens on loopback only. The proxy must strip client-supplied identity headers
before setting the trusted actor header used for L3/L4 receipts. This is still only an access gate: every
domain adapter uses its own server-side Agent Bearer and every domain rechecks scope plus resource grants.
A trusted-LAN literal-IP bypass, when desired, is deployment policy and must not apply to public hostnames
or forwarded traffic; such requests cannot execute L3/L4 operations without a trusted actor.

## Unified interaction path

### Context Pack and suggestions

`shadow.context.v1` is the only cross-surface context envelope. Search results, domain overview actions,
Archive rediscovery and Health weekly review add opaque `shadow://` references plus an explicit goal to the
current Session. Packs expire after 24 hours, never copy domain source data, and do not widen the Agent's
existing capability grants. The prompt names the pack and references so the user can see what is in scope.

Domains may expose a compiled `suggestions` Surface returning `shadow.suggestion.v1`. Nexus validates the
domain, evidence references, validity window, missing-data ratio and allowed actions before rendering. It
stores only user feedback: ignore applies to one dedupe key, snooze hides it for 24 hours, and mute hides the
same domain rule. “View evidence” or “create draft” first creates a Context Pack and starts an ordinary DSH
turn; it never invokes a domain mutation directly.

1. A user enters natural language and/or uploads assets in the persistent Composer.
2. Assets first use the Shadow Asset upload path; the instruction and stable asset references are appended to the visible active DSH Session.
3. Nexus waits for the completed DSH turn and validates its versioned `NexusIntentPlan`; prompt admission is never treated as completion.
4. A read-only discussion returns inline with no Proposal. An explicit fact-saving intent produces one or more inline Proposals; `/ask` and `/record` are optional routing overrides, not separate modes.
5. The DSH result, rather than local keyword rules, decides the domain fan-out and review fields. A batch may contain up to 200 independent proposals and may repeat a domain.
6. Nexus links equivalent pending Nexus and domain Proposals by stable declared fields. The domain URI and Revision win for confirmation, while every source reference remains attached for audit.
7. After explicit confirmation, a model-hidden Host adapter validates and commits the existing or newly created domain draft, stores the canonical receipt, and replaces the inline Proposal with its result.

The interaction prompt permits read-only tools and read-only access to uploaded asset paths. It forbids every domain mutation. A writable domain uses a two-call transaction after confirmation: create an auditable pending review, then commit that exact review through its hidden Host boundary. The unified DSH Profile selects only read/analysis capabilities; draft and formal-write capabilities are not exposed to the model.

## Composer and Conversation

The persistent workbench Composer infers discussion versus recording instead of forcing a mode choice. Its progress reflects DSH execution stages, its response stays inline, and write effects remain explicit Proposal cards. Domain pages may still call the read-only Ask action with visible page context. Asking never implies permission to create or mutate domain facts. Recent DSH Sessions are shown as lightweight continuations, with the current Session named at both the workbench header and Composer.

The Composer treats images and ordinary files identically. The Host performs the Shadow Asset three-step upload, retains the short-lived Upload Token only in memory, and exposes a read-only local view inside the DSH Session sandbox. The queued prompt contains the stable `shadow://nexus/...` reference and local read path; Shadow Asset remains authoritative, and DSH native attachment storage is not used by Nexus.

Review is a global control plane rather than a Session inbox or a second domain database. Every Nexus Proposal retains its source `sessionId` for audit and navigation, but switching the workbench Session does not hide pending work. Pending reviews created by the same domain Agent are discovered through projected model-hidden operations and linked to matching Nexus Proposals; their fields, revision, source and domain URI are cached, while ownership remains in the domain. Confirmation commits the existing domain review instead of creating a duplicate, rejection propagates to that review, and later rediscovery refreshes the linked Proposal without creating a second review item.

Capture groups and federated domain queues can be reviewed individually or in a batch. A batch is processed deterministically and Nexus persists each completed item before moving to the next, so an upstream failure exposes partial progress instead of replaying successful writes. Every conforming domain keeps commit and reject idempotent and makes rejection state plus audit atomic.

## Confirmation levels

Nexus does not ask for confirmation for every operation.

| Level | Examples | Default behavior |
| --- | --- | --- |
| L0 read | summaries, search, today projection | automatic |
| L1 reversible append | bookmark, travel idea, ordinary note | automatic after adapter validation, with receipt |
| L2 sensitive fact | health measurement, ledger transaction, ambiguous classification | Review |
| L3 consequential action | external publish, account change, destructive operation | explicit confirmation |
| L4 protected bulk action | deleting all records, disabling audit | prohibited |

Domain plugins may raise a level but may not lower the platform minimum. An operation that changes meaning because required fields are missing is always routed to Review.

## Failure and ownership rules

- A session message is not proof of a domain write.
- A draft is not a fact.
- Only a domain receipt proves a successful commit.
- Retries reuse an idempotency key derived from the capture event and target capability.
- Partial cross-domain workflows expose per-step receipts; successful steps are not hidden by a later failure.
- Nexus may cache projections, but a domain read always wins on conflict.
- Secrets and production endpoints are supplied by the deployed Shadow Platform configuration, never by a domain manifest committed to Git.

## DSH version boundary

The implementation targets DSH `0.1.1-rc.2` exactly. It relies on documented root/Conversation slots and the public `layout` service shape; it does not inspect Conversation DOM. Build, slot-topology tests, and native Shadow-profile smoke tests must run before changing the DSH version.
