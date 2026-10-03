# Project conventions

- Organize implementation by feature under `src/<feature>/`, with `index.js` as each feature's public entry.
- Each source file is either orchestration/composition or one focused implementation responsibility. Keep SDK calls, storage, validation, card rendering, and routing separate.
- Import another feature through its `index.js`; intra-feature imports may target implementation files.
- `src/index.js` owns process setup and signals; `src/gateway/index.js` composes features without implementing their behavior.
- Prefer dependency injection for platform calls; never require real Feishu credentials in tests.
- `src/core/` must not import platform adapters or legacy facade features, directly or transitively. Chat SDKs, raw-event parsing and presentation belong in `src/adapters/<platform>/`; Pi SDK is allowed in core. See `docs/ARCHITECTURE.md`.
- Scope each core instance to one platform/bot account. Preserve the optional-field `PIGateway { Lark?: ...; QQ?: ... }` design; do not replace it with an exclusive union.
- Keep compatibility facades thin; new live composition should use the explicit core/adapter boundaries.
- Run `npm test`, `npm run check`, and `npm run setup -- --help` after structural changes.
- Never print App Secrets, raw SDK errors, message bodies, or model credentials.
- Preserve config/session/state file paths during structural refactors.
- For an authorized gateway restart, use `npm run restart` (or `pi-lark-gateway restart`) to schedule it after replies and cleanup finish. Never run an immediate `launchctl kickstart -k`, service restart, or kill from the active response. If the running old version has no restart endpoint, report that an initial idle upgrade restart is required; do not silently force it.
