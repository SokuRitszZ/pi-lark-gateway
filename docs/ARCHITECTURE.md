# Gateway layering (release/1.1.0)

## Boundaries

- `src/core/`: account-scoped policy, normalized routing, queue/dedup, approvals,
  run controls, Pi agent/session runtime, identity prompt injection, safe media
  storage/send authorization and persistence. No chat-platform SDK or adapter
  imports. Pi SDK is the execution engine and is allowed here.
- `src/adapters/lark/`: Lark event/access/mention parsing, directory lookup,
  command/debug parsing, action callbacks, SDK transport, card/progress rendering,
  and attachment upload/delivery. Platform acknowledgements and delivery rules
  belong here, not in core.
- `src/gateway/index.js`: composition and lifecycle of this Lark deployment.
  Configuration, onboarding and process/restart infrastructure remain outside
  core. This release does not turn the CLI into a Pi extension.
- Legacy directories (`agent`, `identity`, `messages`, `media`, `lark`, `controls`,
  `approvals`, `progress`, `debug`) retain compatibility exports/facades. The live
  composition uses the new boundaries. QQ has a separate composition/CLI/extension
  in `src/qq-gateway/`, sharing core without importing Lark adapters.
  Compatibility paths are not new extension
  points for other platforms.

## Contracts

`src/core/contracts/index.d.ts` documents JS-facing contracts, not a published
TypeScript package. We intentionally retain `chatId`, `userId`, `key`, `isGroup`
and the old on-disk keys rather than silently migrating stored conversations.

Each core instance is scoped to **one platform and bot account**, with its own
policy and storage root. Do not multiplex unrelated platform/account identities
into one core instance or infer account ownership from a display name.

```ts
interface PIGateway {
  Lark?: LarkIdentity;
  QQ?: QQIdentity;
}
```

This is an optional-field interface, **not** an exclusive union. Empty or multiple
branches are representable. The trusted ingress/instance determines the active
platform; the existence of a branch does not grant authority. Lark's runtime
branch retains the native `sender.open_id`, additional typed IDs, profile status
and matched profile data. QQ preserves `user_openid` for C2C and `member_openid`
plus `group_openid` for groups, based on the pinned SDK's event mapping. QQ
transport is implemented under `src/adapters/qq/`; see `docs/QQ.md` for scope and
remaining live-account verification.

The live Lark path resolves `{ Lark: nativeIdentity }`, then core injects it in
`gateway_sender_identity` for the current turn. Legacy identity imports preserve
the old header shape only for compatibility. Sender lookups remain after policy
admission/dedup and within the session limiter; failed lookups never infer data
from text. Per-turn AsyncLocalStorage is cleared at completion.

## Ingress and operations

The Lark ingress classifies restart/debug commands, normalizes `AccessMessage`,
and calls core routing. Admission happens before the message getter materializes
the full message or mutates thread mappings. Model-input mention placeholders
and policy-match text are deliberately different representations.

Core routing checks block/grant/policy state, requests approval when appropriate,
and dispatches a normalized message plus an optional command closure. Neither
raw event objects nor card callback objects are consumed by core. The dispatcher
returns immediately, queues per session, and retains response cleanup inside the
queue lifetime. The adapter owns platform acknowledgement timing.

Controls and approval state machines accept `GatewayAction` and return generic
`{ type, content }` results. The adapter decodes the callback and renders a toast.
Checks bind actor, current response/request ID and source message ID; stale or
unauthorized actions cannot address arbitrary sessions. Approval persistence is
serialized. Existing request file schema is retained, including historical
`chatType: p2p/group` values.

## Responses and media

The injected response factory returns progress `event`, `finish`, `stop` and
optional session binding/title/image hooks. Lark implements card/plain text,
CardKit fallback, pagination, markdown and tool timeline in its adapter. A new
platform can instead supply a final-only response or just `reply`; it need not
implement cards or editable messages.

Core media validates current-turn authorization, active/cancel state, workspace
and file paths; prepares safe local attachments and model image inputs; and
calls `transport.deliver(message, file, context)`. Delivery adapters **must call
`context.allowed()` again after upload and before external delivery**, propagate
cancellation and respect idempotency. The Lark adapter owns `file_key`, upload,
image-size limits and the image-in-existing-card rule. A generic transport can
send an image without a card, as tested by the fake media transport. Existing
media error codes/text remain compatible; they do not enable platform features.

No capability flag grants permission. Missing interactive approval must fail
closed, not silently permit access. No personal data, credentials or raw provider
errors may be published as diagnostics.

## Compatibility and verification

- Existing config paths, bot account base directory, hashed session directories,
  Lark private/topic keys, thread aliases and approval stores remain unchanged.
- `gateway_send_file` name and Lark-visible tool behavior remain compatible.
- Restart scheduling stays deferred and separately authorized; no automatic
  restart or deployment occurs as part of this refactor.
- `test/core-dispatcher.test.js` recursively checks the complete core import graph
  (only core, safe errors and the Pi SDK are allowed).
- Fake core tests cover policy, routing, control authorization, identity and
  non-card media. `test/layered-flow.test.js` exercises the production Lark ingress
  through normalized routing and the core agent with a fake session pool.
- Existing regression tests cover SDK identity injection, archives, queueing,
  approval persistence, cancellation, card fallback, media and process lifecycle.

Run `npm test`, `npm run check`, `npm run setup -- --help` and `git diff --check`.
Tests do not prove live credentials, platform permissions or production network
connectivity. A separately authorized deployment should include real Lark smoke
checks. Extracting a public shared package remains separate work. QQ text ingress/reply
and local Pi commands are implemented in-repo; actual QQ account verification,
media and advanced interactions remain separate follow-up work.
