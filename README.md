# Shadow Nexus

Shadow Nexus is the root Web shell for the Shadow profile on DeepSeek Harness. It owns the page, navigation, and domain workbench while keeping the official DSH Conversation as a dockable or full-screen Agent surface backed by the same Session.

The current milestone includes a Host + Browser DSH plugin, a responsive root shell, visible Session identity and selection, one intent-aware Composer, unified Shadow Asset attachments, inline Proposal review, dock/full Conversation layouts, lightweight recent-Session continuation, URL-backed navigation, a client module registry, a federated global review queue, declarative cross-domain Search, and an Apps directory. Platform compiles the installed domains, connections and Surfaces into `shadow-nexus-runtime.json`; Nexus contains no built-in domain list, endpoint table or keyword router. The Composer waits for the completed DSH response, returns ordinary discussion directly, and only creates reviewable Proposals when the user intends to save facts. A single interaction can fan out to as many as 200 independent Proposals, including multiple items in one domain. The DSH model has read capabilities only; all domain writes remain behind model-hidden Host boundaries and the domain-owned `shadow.review.v1` protocol.

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

## Shadow Asset attachments

Images and other files use the same Composer upload path. Nexus uploads the original to Shadow Asset, keeps a read-only local view for the active DSH Session, and adds both the stable `shadow://` reference and readable path to the conversation prompt. Any generated Proposal stores the stable attachment references. The short-lived Asset upload token never enters the browser, Nexus state file, or DSH conversation log.

Configure the host plugin with:

```sh
SHADOW_ASSET_BASE_URL=http://127.0.0.1:8400
SHADOW_ASSET_SERVICE_TOKEN_FILE=/run/secrets/shadow-asset-service-token
SHADOW_ASSET_OWNER_ID=00000000-0000-4000-8000-000000000000
SHADOW_NEXUS_ASSET_VIEW_ROOT=/workspace/.shadow-nexus/assets
```

The base URL must use HTTPS, except for a loopback HTTP endpoint. The token file is read server-side on demand. `SHADOW_NEXUS_ASSET_VIEW_ROOT` must be readable from the DSH Session sandbox; the directory contains a cache/read view, while Shadow Asset remains the source of truth.

## Compiled runtime

Set `SHADOW_NEXUS_RUNTIME_FILE` to the immutable Nexus projection produced by Shadow Platform. L3/L4
confirmation additionally requires `SHADOW_CONFIRMATION_PRIVATE_KEY_FILE`, `SHADOW_CONFIRMATION_KEY_ID`
and `SHADOW_CONFIRMATION_ISSUER`. Production must bind DSH to loopback and let the authenticated reverse
proxy strip client identity headers before setting the trusted user header.
