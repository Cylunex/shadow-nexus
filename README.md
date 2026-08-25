# Shadow Nexus

Shadow Nexus is the root Web shell for the Shadow profile on DeepSeek Harness. It owns the page, navigation, and domain workbench while keeping the official DSH Conversation as a full-screen mode backed by the same Session.

The current milestone includes a Host + Browser DSH plugin, a responsive root shell, URL-backed Nexus/Conversation switching, a client module registry, session-backed capture, a review queue, and versioned integration contracts. Health and Ledger can provide live bounded summaries and receive reversible drafts through their machine APIs. Domain applications keep ownership of their data and final writes.

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
