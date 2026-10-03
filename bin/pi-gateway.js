#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildProgram } from '../src/cli/program.js';
import { createUI } from '../src/cli/ui.js';
import { superviseCommand } from '../src/runtime/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const ui = createUI();
const program = buildProgram({ version, ui, run: plan => new Promise(resolve => {
  superviseCommand({
    spawnChild: () => spawn(process.execPath, ['--use-env-proxy', path.join(root, plan.script), ...plan.args], { stdio: 'inherit', env: process.env }),
    onError: () => console.error('gateway_command_failed'),
    onExit: code => { process.exitCode = code; resolve(); },
  });
}) });
try { await program.parseAsync(process.argv); }
catch (error) {
  if (error.code === 'CLI_CANCELLED') { ui.cancel(); process.exitCode = 130; }
  else if (error.code?.startsWith('commander.')) process.exitCode = error.exitCode;
  else { console.error('无法选择平台或操作；请在交互式终端运行，或显式指定：pi-gateway qq start。'); process.exitCode = 1; }
}
