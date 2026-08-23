# Shadow Nexus

Shadow Nexus is the native Shadow workbench for DeepSeek Harness. It brings capture, review, daily context, and domain navigation into one DSH Web experience while keeping the official Conversation available.

The first milestone includes a Host + Browser DSH plugin, a responsive Nexus surface, session-backed capture, a review queue, domain summaries, and versioned integration contracts. Domain applications keep ownership of their data and final writes.

## Development

Requires Node.js 22+ and DSH `0.1.1-rc.2`.

```sh
pnpm install
pnpm run check
pnpm test
pnpm run build
```

Architecture and domain integration notes live in `docs/`.

