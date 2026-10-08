# Post-reply next-step suggestions

This is a shared business feature, not a gateway-specific agent workflow.

## Flow and boundaries

1. After a successful final response is delivered, the shared message dispatcher asks `core/next-steps` to offer suggestions, if the response exposes the presentation capability.
2. `core/agent/suggestions.js` makes an isolated, ephemeral model request with no tools, extensions, skills, workspace context or prompt-template expansion. It uses the configured model/runtime (default model when unconfigured), the latest question (at most 8,000 UTF-16 units) and answer tail (16,000 units), not the private tool transcript or entire session history.
3. The model returns zero to four `{title, detail}` options. Titles are at most 40 UTF-16 units, details at most 500. Validation rejects malformed output. There is no hidden executable action: only displayed title and detail become the selected user request.
4. The adapter adds numbered titles and details to the completed response body. Buttons display only `1`, `2`, `3`, `4`, inline in one row. Lark uses compact auto-width columns without equal-width weights. Telegram uses one native keyboard row; actual button widths are controlled by the client, not the Bot API. If the native message limit would be exceeded, it adds a suggestions continuation card/message instead.
5. A callback contains only an opaque record ID and option index. The business service checks the original sender, exact native response binding, expiry, current policy and consumption state. Other users, including admins acting as someone else, cannot choose for the original sender.
6. Consumption is atomic. The adapter marks the choice with `✅ 已选择`, retains its details and removes all next-step buttons. Only after that update succeeds does the service recheck authorization and submit a new logical user request to the ordinary dispatcher. The new response gets a new card, but retains the session key and context.

`GatewayResponse.nextSteps(view)` is the adapter capability: publish/update a view and return its exact callback message binding. The business service owns generation, records, permission decisions, consumption and dispatch ordering. Adapters only render and normalize callbacks; `presentation/next-steps` shares literal Markdown layout, not business state.

Native sender/message IDs are preserved. A separate trusted `dispatchId` lets a click become a new logical request without forging a platform message ID or colliding with ordinary deduplication. Attachments, mentions and command metadata are not replayed. A verified button click counts as addressing the bot; normal access, deny-text and tools policies still apply.

## Availability

| Adapter / mode | Status |
| --- | --- |
| Lark card replies | Implemented, including terminal CardKit entity updates after streaming cleanup |
| Telegram | Implemented with inline keyboards, entity-offset-safe text and bounded overflow continuation |
| Lark plain-text replies | No suggestion capability; no extra model call |
| QQ | Not enabled: current adapter lacks a verified original-message rewrite/button-consumption path. It does not substitute an extra reply for updating the original message. |

Failed/stopped responses, gateway commands and debug simulations/sleep do not offer suggestions. Empty/invalid model output or suggestion failures leave the completed answer intact. No suggestion is automatically executed.

## Bounds and failure behavior

- One auxiliary analysis attempt per eligible successful turn; maximum four concurrent auxiliary runs per account. Overload skips optional suggestions instead of creating an unbounded model queue.
- Prompt wait deadline: 15 seconds; provider abort is best-effort. Shutdown also aborts analysis and disables selection admission.
- At most 200 in-memory records per account; maximum lifetime 30 minutes. Restart/expiry/eviction makes old buttons unavailable. These are not durable workflow tasks.
- Replay/double-click never starts a second turn. The service does not retry ambiguous publication/update failures or execute a request after a failed selection update.
- If permission changes or admission capacity prevents dispatch after the old card has been updated, the card reports that the next request did not start. Selection is not a claim of execution/success.
- The extra model request consumes normal model quota and can add latency before the same-session queue advances. It does not get host tools or new permissions.
- This change does not activate/restart a running service. Offline tests cover core ordering/authorization/expiry, isolated model requests, terminal CardKit updates, Telegram composition and rich-text/keyboard limits. Real client rendering and live provider acceptance still require separately authorized testing.
