console.error('Direct source npm publish is disabled. Use the pinned shared Action via .github/workflows/release.yml after reviewing publication authorization, the NPM_PUBLISH_ENABLED gate and npm-publish environment. Local smoke fixtures are not release artifacts.');
process.exitCode = 1;
