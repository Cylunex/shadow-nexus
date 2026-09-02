# Shadow Nexus

Shadow Nexus is the root Web shell for the Shadow profile on DeepSeek Harness. It owns the page, navigation, and domain workbench while keeping the official DSH Conversation as a dockable or full-screen Agent surface backed by the same Session.

The current milestone includes a Host + Browser DSH plugin, a responsive root shell, an adaptive cross-domain Today surface, visible Session identity and selection, one intent-aware Composer, unified Shadow Asset attachments, inline Proposal review, dock/full Conversation layouts, lightweight recent-Session continuation, URL-backed navigation, a client module registry, a federated global review queue, declarative cross-domain Search, an Activity/Receipt Ledger, a Trust Center, and an Apps directory. The dashboard resolves stable Entity Registry declarations from existing domain summaries and combines freshness, common actions, connection state, explainable suggestions and execution receipts without copying domain fact tables. Platform compiles the installed domains, connections, Entities and Surfaces into `shadow-nexus-runtime.json`; Nexus contains no built-in domain list, endpoint table or keyword router. The Composer waits for the completed DSH response, returns ordinary discussion directly, and only creates Proposals when the user intends to save facts. By default, Nexus trusts the Agent to execute server-validated L0-L2 proposals automatically and keeps receipts for after-the-fact review; L3 still requires explicit confirmation, L4 is prohibited, and failed automatic execution falls back to the review queue. A single interaction can fan out to as many as 200 independent Proposals, including multiple items in one domain. The DSH model has read capabilities only; all domain writes remain behind model-hidden Host boundaries and the domain-owned `shadow.review.v1` protocol.

The conversational and batch capture paths share one business-preservation policy: every explicit fact is checked before routing, optional omissions do not trigger confirmation, complete siblings continue while one incomplete fact is clarified, and model responses cannot claim a write before the Host returns a domain receipt. When Health and Ledger are installed, meal/order inputs are audited as two independent fact groups, with household measures retained as notes and food versus order evidence attached only to the owning domain.

User-authorized food photo estimates are supported with explicit provenance and uncertainty in notes; they are never presented as measured values or confirmed consumption. Missing required facts are asked for, and a reporting timestamp must not be substituted for a purchase timestamp.

Model planning uses the versioned `shadow.nexus.plan.v1` / `shadow.nexus.capture.v1` contracts. Nexus prefers a
structured tool-call block when a Provider exposes one; the provider-neutral fallback accepts only one complete,
strictly validated JSON frame. Legacy tagged envelopes remain read-only-compatible, while malformed or missing
plans fail closed to an answer/clarification with zero drafts. The Host validates the full contract again before
creating Proposals. Activity metadata records plan source, capability reference, correlation/idempotency identifiers,
failure class and the authoritative domain receipt without copying Proposal fields.

Context Packs let Search, domain pages and suggestion cards place short-lived `shadow://` references into
the active Session without copying domain facts. Compiled Health and Archive suggestion surfaces appear as
explainable cards with evidence, freshness, and ignore/snooze/mute controls. Android Share can prefill the
same Composer with text, links or one file, but never sends or writes automatically.

Nexus also produces cadence-aware briefs from exception counts, suggestions and Entity freshness without
placing sensitive Entity values in notification text. Governed Memory is opt-in and versioned, with provenance,
expiry, correction and forget operations. Portable export omits credentials, attachments and Proposal fields.
When running inside Shadow App, Nexus uses the capability-declared Promise `ShadowNativeBridge`; failed network-only
quick actions can enter the native Keystore-encrypted queue and are removed only after normal server execution
succeeds. The companion Platform `shadow-capability-status.json` remains a stage-by-stage evidence projection:
unknown, failed and passed are never inferred from one another.

The bundle disables the official `ui-layout` row and replaces it with the Nexus root. The official Conversation, tool, permission, attachment, workflow, and other feature plugins remain unchanged and render through the child slots owned by Nexus. Install this bundle in a dedicated `shadow` profile; retain the stock `web` profile as the recovery and upgrade-diagnostic surface.

## Development

Requires Node.js 22+ and DSH `0.1.1-rc.2`.

```sh
pnpm install
pnpm run check
pnpm test
pnpm run build
```

Architecture and domain integration notes live in `docs/`; the public client registration contract is documented in `docs/client-modules.md`.
The source-only DSH `0.1.2-alpha.1` migration assessment is in `docs/dsh-0.1.2-migration.md`.

## Shadow Asset attachments

Images and other files use the same Composer upload path. Nexus uploads the original to Shadow Asset, keeps a read-only local view for the active DSH Session, and adds both the stable `shadow://` reference and readable path to the conversation prompt. Each generated Proposal explicitly selects only the stable attachment references that belong to that domain fact; unselected files remain conversation context and are not forwarded blindly. The short-lived Asset upload token never enters the browser, Nexus state file, or DSH conversation log.

Configure the host plugin with:

```sh
SHADOW_ASSET_BASE_URL=http://127.0.0.1:8400
SHADOW_ASSET_SERVICE_TOKEN_FILE=/run/secrets/shadow-asset-service-token
SHADOW_ASSET_OWNER_ID=00000000-0000-4000-8000-000000000000
SHADOW_NEXUS_ASSET_VIEW_ROOT=/workspace/.shadow-nexus/assets
```

The base URL must use HTTPS, except for a loopback HTTP endpoint. The token file is read server-side on demand. `SHADOW_NEXUS_ASSET_VIEW_ROOT` must be readable from the DSH Session sandbox; the directory contains a cache/read view, while Shadow Asset remains the source of truth.

## Compiled runtime

Set `SHADOW_NEXUS_RUNTIME_FILE` to the immutable Nexus projection produced by Shadow Platform. L3
confirmation additionally requires `SHADOW_CONFIRMATION_PRIVATE_KEY_FILE`, `SHADOW_CONFIRMATION_KEY_ID`
and `SHADOW_CONFIRMATION_ISSUER`. Production must bind DSH to loopback and let the authenticated reverse
proxy strip client identity headers before setting the trusted user header.

`SHADOW_NEXUS_EXECUTION_POLICY` defaults to `trusted`: L0-L2 execute automatically and remain visible in
the review history. Set it to `review-first` for a recovery deployment that queues every writable proposal.
Runtime-declared risk is authoritative and the model may raise, but never lower, the effective risk.
