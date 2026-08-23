# Shadow Nexus architecture

Shadow Nexus is the Shadow-facing workbench inside DSH. It unifies the interaction surface, not domain ownership.

## Runtime shape

```text
DSH Web
├── official Conversation + Composer
└── Shadow Nexus browser surface
          │ current Session + HTTP projection
          ▼
Shadow Nexus host plugin
├── capture queue and review policy
├── cross-domain read model
└── domain capability registry
          │ signed machine calls
          ▼
Health / Ledger / Travel / Archive / Foliant
```

The Host and Browser halves ship as one DSH plugin. `shell.overlay` provides the seat, while the official conversation remains mounted and usable. The current DSH Session is the interaction and context source. Each domain application remains the structured fact source and the only component allowed to commit its facts.

## Capture path

1. A user enters natural language in Nexus or the official Conversation.
2. The original text is appended to the active DSH Session.
3. Shadow classifies it into a domain intent and creates a draft with the original text intact.
4. Policy decides whether it can proceed automatically or must enter Review.
5. A domain adapter validates and commits through the domain's own API.
6. Nexus stores a receipt and projects the result back into the session and UI.

The first slice in this repository implements steps 1–4 as an explicit preview. Its receipt starts with `preview:` and must never be interpreted as a domain write.

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

The initial implementation targets DSH `0.1.1-rc.2` exactly. The browser bridge relies on documented slots plus the current official Conversation DOM seam. Build and native smoke tests must run before changing the DSH version.

