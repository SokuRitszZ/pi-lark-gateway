# Telegram gateway (grammY)

Telegram lives in this repository, on the same shared core as Lark and QQ. It uses community-maintained **grammY 1.46.0**, not a Telegram-maintained SDK. No separate gateway repository is needed.

## Quick start

```sh
pi-gateway tg setup
pi-gateway tg check
pi-gateway tg start
pi-gateway tg status
pi-gateway tg logs
```

1. Create a bot with **@BotFather**. Enter its token only in the local masked wizard, never in a group chat, command-line argument, screenshot or issue.
2. Select long polling (recommended) and the model. The wizard can prefill local Pi defaults; model authentication still belongs to Pi.
3. When prompted, privately send `/start` to the bot, then select and explicitly confirm **your own numeric user ID** as owner. The first person sending a message is **not** automatically authorized.
4. Skipping identification saves an incomplete configuration. Resume with `pi-gateway tg authorize`; normal startup rejects a missing owner.
5. Start the gateway, privately ask a question, then test `/ask@YourBotUsername question` in a group. Non-owner users require approval or a configured allowlist. An owner must have privately started the bot before it can deliver approval messages.

`pi-gateway` also presents Telegram in its arrow-key menu. All commands accept the same `--config /absolute/path/config.json`. `PI_TG_CONFIG` overrides the default path. `authorize`/`discover` require the same account to be stopped; live access requests instead use owner approval buttons.

## Feature mapping

| Existing capability | Telegram implementation |
| --- | --- |
| Shared agent, tools, sessions and archives | Existing core; tools default **none**, independently of QQ/Lark |
| Private/group access and text rules | Owner/admin roles, separate private/group policies, per-group overrides, allow/deny regexes |
| Access approvals | Owner DM with approve/deny/revoke/block/unblock buttons; persisted, bound to owner and exact message |
| Trusted sender identity | Optional `PIGateway.Telegram`; native bot/chat/topic/user IDs, never Lark/QQ ID aliases |
| Mention handling | Native mention/text-mention metadata; ordinary usernames are not resolved to invented user IDs |
| Conversation isolation | Bot + chat + forum topic + sender; members never share a model session |
| Quoted replies | `reply_parameters`, including forum topic routing |
| Processing reactions | Attempts 👀, removes it at cleanup; unavailable/disallowed reactions do not block answering |
| Streaming and tool timeline | Stable placeholder edited in place; coalesced assistant text and tool names/statuses, never reasoning, tool arguments or raw tool results |
| Rich text and long answers | Telegram entities rather than injected HTML; bounded numbered continuation messages |
| Stop / steer | Live Stop button, `/stop`, `/steer instruction`; reply to a specific bot response to target it, including authorized admin control |
| Attachments | Download to the session inbox, supported image vision, session-scoped `gateway_send_file` |
| Configuration changes | Access policies/group overrides/answer timeout reload; model, credentials and transport require restart |
| Operations | Wizard, check, discover, authorize, background start/status/logs/stop, explicit foreground, deferred restart, private local backup |
| Owner debug | `/debug sleep 500ms` (up to 10m) and single-message `/debug assume label` + newline + question |
| Embedded Pi | Local interactive `/tg start|stop|status`; no startup side effects and no remote print-mode service control |
| Transport | Long polling, or explicitly registered HTTPS webhook with secret-header verification |

**Native UI differences:** Telegram does not implement Feishu CardKit, cards, card forms, embedded card images, or the Lark identity/contact directory. Buttons, slash commands, rich-text messages, separate photo/file messages and numbered continuation pages provide the corresponding workflow. Native text drafts are not used; streaming edits a persistent bot message. This is feature/workflow parity, not identical platform APIs or visual layout.

## Configuration and authority

Default config: `~/.config/pi-tg-gateway/config.json`.

```json
{
  "version": 1,
  "botId": "123456789",
  "credentialsFile": "credentials-EXAMPLE.json",
  "transport": "polling",
  "model": null,
  "answerTimeoutMs": 120000,
  "access": {
    "owner": "987654321",
    "admins": [],
    "private": {
      "enabled": true, "users": "allowlist", "allowedUsers": [],
      "trigger": "all", "tools": "none", "onUnknown": "ask_owner"
    },
    "groups": {
      "enabled": true, "users": "allowlist", "allowedUsers": [],
      "trigger": "mention", "tools": "none", "onUnknown": "ask_owner"
    }
  },
  "groups": {}
}
```

The IDs above are examples. Credentials files are mode **0600 plaintext**, not encrypted. `TELEGRAM_BOT_TOKEN` overrides the saved token; webhook mode also supports `TELEGRAM_WEBHOOK_SECRET`. No dotenv loading is implicit. A token's bot ID must match `botId`, and startup verifies `getMe`.

- Owner/admin roles bypass user allowlists, **not** disabled policies or group trigger/text rules. By default the owner may ask in any group containing the bot. Disable the global group policy and explicitly enable selected group overrides if that is too broad.
- Unknown users can request access only where policy/trigger rules permit. Approvals grant a specific chat+user, not all groups and not administrator status. They do not automatically enable tools. A deny defaults to a pending-request cooldown; blocking is the durable deny.
- `tools: "all"` grants **host-machine** tools and extensions; it is **not a sandbox**. Enable deliberately only for trusted scopes. Do not expose host tools through a broadly accessible group.
- Group overrides use string chat IDs (often `-100…`) and a complete policy. Private and group allowlists are separate. `allowTextPatterns`/`denyTextPatterns` use existing core semantics; deny wins. Approval grants do not bypass disabled policies or text/trigger filters.
- ACL reload does not roll back already-executed host operations. New queued model work and media sends recheck access; use Stop/host service controls when interruption is required.
- Sender-chat/anonymous-admin messages, channel posts and edited-message updates are deliberately rejected rather than assigned guessed user identities. Other bots' messages are ignored.
- `/debug assume` is owner-only (not all admins). It creates an isolated `debug_…` policy/session subject and labels approval requests as simulated. The trusted native sender ID remains the real owner; no employee directory lookup or Telegram user impersonation occurs. Use the response button or an explicit reply target to stop a simulated model run. Debug sleep is a bounded scheduler test, not an interruptible model call.
- Default Telegram privacy mode does **not** guarantee delivery of ordinary `@bot` text. Prefer `/ask@BotUsername` or replies to the bot. Broader group visibility requires deliberate BotFather/privacy/admin configuration.

## Presentation, rate limits and media

Telegram replies use text cards: a bold status title, a short `────────────` divider, then a named content section. Processing uses **⏳ 正在处理 / 执行进度**, successful response completion uses **✅ 回复完成 / 结果**, errors use **⚠️ 本次执行未完成 / 状态说明**, and cancellation uses **⏹ 当前回复已停止 / 状态说明**. Approvals use **🔐 等待访问授权** and explicit updated decision titles. This is message formatting, not CardKit or a Mini App.

- The working card retains its Stop button and updates the same message. Long progress keeps the latest bounded body without losing its title.
- Final cards replace the progress display with the authoritative answer rather than appending the old tool transcript. Every continuation page repeats the status title and page number, preserving rich-text entity offsets and Telegram length limits.
- A completed response does not mean the underlying task/tests succeeded. The adapter does not fabricate verification, result or next-step claims; additional sections appear only in the actual answer. Short control acknowledgements remain lightweight messages/toasts.
- Existing buttons and permissions are unchanged. This layout has offline tests, not live Telegram client acceptance.

- At most one progress edit is pending per response; newer progress replaces older snapshots. Per-chat pacing spaces text sends/edits by at least 1.1s in private chats and 3.1s in groups. Telegram can impose additional limits: explicit short `429 retry_after` responses get one bounded retry; unknown send failures are not blindly resent.
- A final response edits its original placeholder, then sends at most **12 numbered pages**, approximately 3900 UTF-16 units per page. Excess output has an explicit truncation notice. An ambiguous failure can leave partial pages; the gateway does not replay the whole answer and create duplicates.
- Commands/buttons cannot control a different message, unauthorized member, expired run or replaced session. Queued placeholders are not yet interruptible; plain `/stop` targets the sender's actually bound current run, not their newest queued placeholder.
- Receive: up to 4 attachments and 30 MiB per core turn; Telegram cloud file downloads are additionally capped at 20 MiB each. PNG/JPEG/GIF/WebP up to 5 MiB can be passed to a vision-capable model. Other files/audio/video are saved, **not automatically parsed or transcribed**. Media albums are individual updates, not automatically merged.
- Send: current-session inbox/outbox only, user request/confirmation required, no arbitrary recipient. Photos use native photo messages (up to 10 MiB); GIFs use animation messages; other files or explicitly requested ordinary files use document messages. Platform-specific dimensions/formats/permissions still apply. Never send credential backups through chat.
- At most 10 admitted unfinished messages per account and 3 per session (including queued turns). Excess turns log `tg_busy` without calling the model. Non-admin ingress is capped at 100 updates/minute; owner/admin controls are exempt from this counter but model admission still has capacity limits. Deduplication is memory-only (10,000 entries), not exactly-once delivery across crashes.

## Networking and webhook

Both network paths need a working proxy when Telegram/model hosts are unreachable:

- Standalone model requests use the shared environment-proxy setup (Undici).
- grammY **and file downloads** use a separate `node-fetch`/`https-proxy-agent` path honoring HTTP(S) proxy and `NO_PROXY` environment settings. An Undici global dispatcher alone does not configure grammY. SOCKS proxy URLs are not supported by this adapter.
- SDK errors, token-bearing file URLs and message bodies are not intentionally logged. Do not enable raw SDK debug tracing in shared logs.

Webhook wizard configuration requires a public HTTPS URL plus a loopback HTTP listener behind your reverse proxy. The URL path must match the listener path. A random webhook secret is saved with the token.

```sh
pi-gateway tg webhook-register
pi-gateway tg authorize  # identify owner, if not done
pi-gateway tg start
```

Registering is an explicit Bot API mutation. The listener checks method, exact path, constant-time secret equality, 1 MiB body size and a 10s body timeout before handling an update. Startup refuses to replace/delete another registered webhook. Long polling likewise refuses an existing webhook rather than silently taking it over. Do not run another polling process for the same bot: the local account lock cannot detect other hosts or unrelated implementations, and Telegram polling conflicts can interrupt those deployments. Telegram registration/permissions, reverse-proxy TLS and actual update delivery must be verified live; URL equality alone cannot prove the remote secret is correct.

## Lifecycle, state and backups

```sh
pi-gateway tg start --foreground     # debugging; no managed self-restart
pi-gateway tg stop
pi-gateway tg restart                # managed instance: enqueue idle/deferred restart
pi-gateway tg backup --service-stopped --output /private/path/tg-backup.tar.gz
```

- Unified `start` returns after application readiness; `pi-tg-gateway start` is the legacy foreground equivalent. Background mode is not boot auto-start and cannot guarantee connectivity while the machine sleeps.
- `restart` and authorized chat `/restart` use the existing idle scheduler: wait for replies, final sends and cleanup, then the service worker relaunches. No immediate PID kill from a response. Foreground/embedded instances without a restart owner reject restart requests instead of taking over an unrelated process.
- Explicit `stop` aborts active model work and shuts down; it is not the idle restart operation and may leave an interrupted placeholder/reaction. Managed stop has the common bounded shutdown deadline.
- Per-bot state is under `~/.local/share/pi-tg-gateway/<botId>/`, including sessions, inboxes and `access-approvals.json`. Directory mode is 0700. The exclusive account lock is shared by foreground, embedded, discovery, managed and backup operations; a release will not unlink a replaced lock file. Never blindly remove a stale lock or kill a saved PID.
- Background service socket/log identity uses platform plus config path, under `~/.local/share/pi-gateway/services/`; use the same `--config` for every command. Logs are bounded and diagnostic-code only.
- Stop the service before backup and explicitly acknowledge it. Backup also holds the account lock, refuses unsafe symlinks/special files and existing output, and writes a 0600 archive of config/saved credentials plus state, excluding the runtime lock. Environment-only credentials and global Pi authentication are **not** included. Restore manually while stopped, preserving private permissions and replacing example paths/IDs correctly; archives contain private conversations and must not be shared.

## Validation status

The implementation has credential-free tests for normalization, identity/session separation, approval/stop callback authorization, queue limits, bounded streaming, rich-text pagination, native API parameters, rate pacing, ambiguous-send handling, media limits, webhook validation, setup, lock ownership, policy reload, deferred restart, managed startup failure, backup and the Pi extension. Existing Lark/QQ regressions also pass. Packaged CLI smoke tests cover Telegram help and safe missing-config failure without contacting Telegram or a model.

**Not live-verified:** real Telegram updates, model generation through this adapter, reaction permissions, client formatting/media rendering, hosted webhook/TLS delivery and production token/proxy combinations. No existing live Lark/QQ service is restarted by installing this implementation.
