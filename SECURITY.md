# Security

## Supported scope

Domestic Feishu, a single gateway process per bot, trusted operator-owned macOS/Linux hosts.
New installations default to owner/approved-user access and no tools. Do not expose an
open-access tool-enabled bot to untrusted users. This is not a multi-tenant sandbox.

`tools: all` can execute host commands, read files, and load local extensions and memory.
Group participants share thread context. Never treat a prompt instruction as credential
isolation. Use a dedicated OS account and minimal model/bot privileges.

## Sensitive data

Configuration, credential files, session JSONL, archives and backups are private plaintext,
not encrypted storage. Keep files 600 and directories 700, use disk encryption and encrypt
backups before copying off-host. Do not commit `.env`, credentials, `~/.pi`, state or logs.
The release packer uses an allowlist and rejects common credential/session filenames;
this does not replace human secret review of source files.

## Reporting

Do not post secrets, raw transcripts or exploit details in public issues/group chats.
Report privately to the deployment owner through your existing trusted channel. Before
external release the rights holder must publish a dedicated private security contact;
no public reporting address is invented here.

If a credential may have leaked: stop the service, revoke/rotate affected bot/model
credentials at the provider, restrict access, preserve necessary evidence privately,
then update local files and verify before restarting. Deleting logs is not remediation.

## Automated publication

Protect main, release/* branches and workflow changes. Once NPM_PUBLISH_ENABLED=true,
trusted release/x.y.z pushes authorize beta publication; merging a same-repository
release PR into main authorizes the stable version. Closed-unmerged or forked PRs do
not publish. Configure npm's trusted publisher for release.yml and the npm-publish
GitHub environment (allow release/* and main branches); tests/builds are read-only, only the npm job
gets id-token:write, and only the final GitHub Release job gets contents:write.
Do not add long-lived npm tokens as a silent fallback. Publication jobs download and
verify the already-tested artifact rather than executing dependency installation or
rebuilding it. Version stamping only changes staged manifests, not the source branch;
artifacts retain the actual push/merge commit identity. Existing registry versions and
Release assets are never overwritten. Automatically generated v* tags are release
records, not workflow triggers.

## Updates

Install only verified release artifacts; compare SHA-256 with a trusted distribution
channel. A checksum alone is not a signature. Review dependency/license changes and run
`npm run release:check` before publishing. Never run `npm audit fix --force` unattended.
