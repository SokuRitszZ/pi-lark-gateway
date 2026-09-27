# Changelog

## 1.0.0-rc.1 — GA candidate (not yet published)

### Added
- Single-process limit of ten concurrent conversation tasks; FIFO waiting and per-conversation serialization.
- Idle session archiving after 30 days: isolated summaries, private persistence, cleanup recovery, and summary-based continuation.
- Manual Feishu setup with hidden secret input, local doctor, private stopped-service backups, and clean-home installation smoke test.
- CI matrix, checked source archive packaging with lockfile and source commit metadata; installation, operations, release and security documentation.
- npm runtime distribution with executable pi-lark-gateway CLI, generated shrinkwrap, tarball installation smoke and gated beta/latest publication.
- Branch-driven GitHub Actions releases: each release/x.y.z push generates x.y.z-beta.<run> on beta; a same-repository release PR merged into main publishes x.y.z on latest. Version manifests are stamped in staging without source commits.
- Reusable test matrix, exact-artifact smoke/verification, opt-in npm OIDC publication and draft-to-public GitHub Releases with immutable assets and integrity-checked retries.

### Changed
- Remove duplicate local release planners, packers and publishers after adopting the pinned shared Action; retain workflow contract tests, fail-closed source publication and isolated installation smoke fixtures, with package-content checks also applied to the Action's exact tarball.
- Constrain inline image previews with a 278px JSON 2.0 column instead of legacy compact-width image attributes; keep default card width and existing error fallback behavior.
- Use default-width reply cards with compact inline image previews, preserving full-image viewing on click.
- Embed outgoing images in the current response card instead of standalone image messages; serialize image/text updates, retain images through finalization and native fallback, and fail explicitly without an active card.
- Fix undefined image MIME errors with the installed Pi provider's flat ImageContent contract; normalize legacy image blocks on history replay without rewriting original JSONL, with real provider-serialization and SDK-resume regression tests.
- Receive image/file/audio/video attachments after admission, feed supported images to vision models, and add a current-conversation file-sending tool gated by tools:all, bounded private storage and safe paths; document resource permissions and media limits.
- Document audited Feishu application permissions and required event/callback setup; show the same checklist and app-specific permissions link after QR/manual onboarding, with offline `setup --permissions` and `--permissions-json` commands.
- Prefer native CardKit typewriter updates for assistant text in card mode, with per-card sequencing/throttling, stream finalization and automatic same-message fallback to legacy card updates; leave tool details immediate and normal replies unchanged.
- Recognize a leading Feishu `/restart` command at gateway ingress for owner/admins, accepting trailing remarks and plain rich-text messages without any model fallback, respecting access policy and waiting for confirmation plus all accepted output/cleanup before the deferred restart.
- Add `restart` CLI scheduling: wait for all accepted replies, card updates and cleanup before a delayed managed restart; coalesce requests and never force-kill the active response.
- Collapse adjacent same-kind card tool calls as `tool ×N`, without parentheses; show the full sanitized operation in a fenced Markdown block while the newest call remains the last visible timeline output, including after it completes. Collapse details only when subsequent text or a new tool appears, and preserve balanced code fences across byte-budgeted continuation cards.
- Card replies retain streamed assistant commentary, chronological tool statuses and final text without duplicating the SDK's aggregate answer. Live overflow reuses continuation cards; stopped/error cards preserve partial progress. Normal text reply mode is unchanged.
- Release workflow directly calls the SHA-pinned SokuRitszZ/npm-release-action for planning, packaging and publication; gateway-specific matrix tests and exact-tarball CLI smoke remain in this repository. Shared artifacts use bundle.json, SHA256SUMS and a source/ archive root.
- New installations require owner approval for unknown users; groups require a mention; tools default to disabled.
- Domestic Feishu only. International Lark setup/configuration is rejected.
- Direct dependency versions pinned; existing explicit access/tool settings are preserved.

### Fixed
- Archival failures keep available original transcripts and do not block normal conversations. Resumed conversations invalidate stale cleanup plans.
- Setup now accurately describes whitelist approval rather than open access.

### Known limits
- Queue length/per-user rate limits are not bounded; ten-session concurrency is not a memory or cost quota.
- Deduplication is in memory; restart may replay work. Shutdown queue handling remains unchanged.
- Tool-enabled deployment is not sandboxed; approvals are not a host security boundary.
- Image/audio/file parsing is not implemented. Archived summaries are lossy.
- Scan registration uses an upstream interface with no public stability guarantee; manual setup is the fallback.

## 0.1.0

Initial locally deployed gateway: Feishu WebSocket, Pi SDK conversation sessions,
access approval, configuration reload, normal/card replies and response controls.
