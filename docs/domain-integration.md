# Domain integration

A Shadow domain stays independently deployable and exposes only a small plugin boundary to Nexus.

## Required contribution

Each domain provides:

1. a `shadow.domain.v1` manifest;
2. read capabilities for allowed summaries and queues;
3. draft validation capabilities;
4. commit capabilities returning durable receipts;
5. optional Surface contributions for domain-specific views;
6. its DSH Skills and prompts in the domain repository.

Client Surfaces are installed DSH Client plugins. They register through the versioned `shadowNexus` service and are disposed with their Cordis effect. The manifest never supplies a remote script URL.

The manifest shape is defined in `contracts/domain-manifest.schema.json`. It describes semantics and capability names, not deployment addresses or credentials. Runtime locations and machine credentials come from Shadow Platform's private configuration.

## Capability behavior

- Read calls are side-effect free and must report freshness.
- Draft calls normalize input and report missing or ambiguous fields.
- Commit calls require an idempotency key and return the created or updated domain identifier.
- Destructive calls must be separately named; a generic `delete` capability is not accepted.
- Every response includes a protocol version and a trace identifier.

Suggested response envelope:

```json
{
  "protocol": "shadow.domain.v1",
  "traceId": "trace_example",
  "data": {},
  "warnings": [],
  "receipt": null
}
```

## DSH responsibilities

DSH owns Sessions, the Shadow Profile, tool availability, model selection, and the official Conversation. Domain Skills remain in their domain repository and are assembled into the `shadow` Profile at deployment. Nexus supplies the common workbench and routing context; it does not centralize domain prompts.

The Nexus capability directory must distinguish installable plugins, Apps/connectors, Skills, MCP servers/tools, and workflows. Permission UI must separately show the requested preset and the Host-projected effective sandbox; display text or model messages are not authorization sources.

## Rollout order

Use one vertical slice before adding breadth:

1. Ledger pending transaction summary + transaction draft/commit.
2. Health today summary + measurement draft/commit.
3. Travel plan summary + visit/idea capture.
4. Archive capture and search.
5. Foliant after its current redesign stabilizes.

For every domain, verify read-only projection, low-risk append, required-review behavior, invalid credential behavior, idempotent retry, and receipt reconciliation.
