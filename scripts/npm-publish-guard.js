console.error('Direct source npm publish is disabled. Use npm run release:npm -- --publish --confirm-publication after reviewing the exact release/tag, public license permissions and registry account.');
process.exitCode = 1;
