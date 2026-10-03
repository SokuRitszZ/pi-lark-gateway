#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { HELP, resolveCommand } from '../src/cli/index.js';
import { superviseCommand } from '../src/runtime/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (['--help', '-h', 'help'].includes(args[0])) console.log(HELP);
else if (['--version', '-v'].includes(args[0])) console.log(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version);
else {
  let rl;
  const controller = new AbortController();
  try {
    const plan = await resolveCommand(args, async label => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('interactive_terminal_required');
      if (!rl) { rl = createInterface({ input: process.stdin, output: process.stdout }); rl.on('SIGINT', () => controller.abort()); }
      return rl.question(label, { signal: controller.signal });
    });
    rl?.close();
    superviseCommand({
      spawnChild: () => spawn(process.execPath, ['--use-env-proxy', path.join(root, plan.script), ...plan.args], { stdio: 'inherit', env: process.env }),
      onError: () => console.error('gateway_command_failed'), onExit: code => { process.exitCode = code; },
    });
  } catch {
    console.error('无法选择平台或操作；自动化运行请显式指定，例如 pi-gateway qq start。');
    process.exitCode = 1;
  } finally { rl?.close(); }
}
