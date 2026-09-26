# Project conventions

- Organize implementation by feature under `src/<feature>/`, with `index.js` as each feature's public entry.
- Each source file is either orchestration/composition or one focused implementation responsibility. Keep SDK calls, storage, validation, card rendering, and routing separate.
- Import another feature through its `index.js`; intra-feature imports may target implementation files.
- `src/index.js` owns process setup and signals; `src/gateway/index.js` composes features without implementing their behavior.
- Prefer dependency injection for platform calls; never require real Feishu credentials in tests.
- Run `npm test`, `npm run check`, and `npm run setup -- --help` after structural changes.
- Never print App Secrets, raw SDK errors, message bodies, or model credentials.
- Preserve config/session/state file paths during structural refactors.
