# Changelog

## 1.0.0-rc.1 — GA candidate (not yet published)

### Added
- Single-process limit of ten concurrent conversation tasks; FIFO waiting and per-conversation serialization.
- Idle session archiving after 30 days: isolated summaries, private persistence, cleanup recovery, and summary-based continuation.
- Manual Feishu setup with hidden secret input, local doctor, private stopped-service backups, and clean-home installation smoke test.
- CI matrix, checked source archive packaging with lockfile, file hashes and source commit; installation, operations, release and security documentation.
- npm runtime distribution with executable pi-lark-gateway CLI, generated shrinkwrap, tarball installation smoke, explicit local publication confirmation and automatic beta/next/latest selection.
- Branch-driven GitHub Actions releases: each release/x.y.z push generates x.y.z-beta.<run> on beta; a same-repository release PR merged into main publishes x.y.z on latest. Version manifests are stamped in staging without source commits.
- Reusable test matrix, exact-artifact smoke/verification, opt-in npm OIDC publication and draft-to-public GitHub Releases with immutable assets and integrity-checked retries.

### Changed
- Add `restart` CLI scheduling: wait for all accepted replies, card updates and cleanup before a delayed managed restart; coalesce requests and never force-kill the active response.
- Collapse adjacent same-kind card tool calls as `tool ×N`, without parentheses; only the newest call shows a sanitized operation preview capped at 100 Unicode characters.
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
