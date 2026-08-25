# Shadow Nexus architecture

Shadow Nexus is the Shadow-facing root Web shell over DSH Runtime. It owns presentation and navigation, not domain facts or the Agent loop.

## Runtime shape

```text
DSH UI Renderer
└── Shadow Nexus root
    ├── Nexus workbench (default, full screen)
    ├── official Sidebar + Conversation (on demand, full screen)
    ├── official Details
    └── shared overlays
          │ same current Session + HTTP projection
          ▼
Shadow Nexus host plugin
├── capture queue and review policy
├── cross-domain read model
└── domain capability registry
          │ signed machine calls
          ▼
Health / Ledger / Travel / Archive / Foliant
```

The Host and Browser halves ship as one DSH plugin. In the dedicated Shadow profile, the bundle disables official `ui-layout`; Nexus becomes the only `root` occupant and declares the `sidebar`, `conversation`, `details`, and `shell.overlay` child slots. It also provides the small `layout` service consumed by official Conversation and projects the upstream theme onto the document. Sidebar and Conversation remain mounted while hidden so session navigation, streaming, draft, and scroll state survive surface switches. The current DSH Session is the interaction and context source. Each domain application remains the structured fact source and the only component allowed to commit its facts.

The stock `web` profile must remain available without the Nexus bundle. Root ownership is a composition boundary and is not hot-swapped inside a running renderer.

## Browser navigation and modules

The query parameters `surface` and `view` are the durable browser navigation state. Nexus defaults to `surface=nexus` and `view=today`; browser back/forward and refresh preserve explicit selections. DSH remains the sole owner of current Session selection.

Nexus provides the `ctx.shadowNexus.registerModule()` service. Built-in Today, Capture, Review, and the initial domain pages use the same versioned registration contract as external client plugins. Registrations have namespaced IDs, unique routes, deterministic ordering, availability and badge hooks, and effect-scoped disposal. A removed active module falls back to Today.

Installed domain UI code must enter through a trusted DSH Client plugin. A domain manifest may describe a Surface but never names remotely executed JavaScript.

## Authentication boundary

Nexus does not implement a second login inside DSH. The dedicated public Nexus origin must protect the
entire DSH surface (HTML, plugin assets, HTTP APIs, and WebSockets) with Shadow Identity at the reverse
proxy, while the DSH upstream listens on loopback only. This is an access gate, not a domain authorization
source: Nexus does not trust forwarded user headers, and every domain adapter continues to use its own
server-side Agent Bearer. A trusted-LAN literal-IP bypass, when desired, is deployment policy and must not
apply to public hostnames or forwarded traffic.

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

The implementation targets DSH `0.1.1-rc.2` exactly. It relies on documented root/Conversation slots and the public `layout` service shape; it does not inspect Conversation DOM. Build, slot-topology tests, and native Shadow-profile smoke tests must run before changing the DSH version.
