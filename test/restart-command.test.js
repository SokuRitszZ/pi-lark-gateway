import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestartCommand, isRestartCommand, createRestartScheduler } from '../src/restart/index.js';
import { createMessageHandler } from '../src/messages/index.js';
import { createRouter } from '../src/gateway/route.js';
import { canControlResponse } from '../src/controls/index.js';
import { makeConfig } from '../src/config/index.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const event = (text, { id = text, user = 'owner', group = false, mention = false } = {}) => ({
  sender: { sender_type: 'user', sender_id: { open_id: user } },
  message: { message_id: id, chat_id: 'chat', chat_type: group ? 'group' : 'p2p', message_type: 'text', content: JSON.stringify({ text }),
    mentions: mention ? [{ key: '@_bot', name: 'Bot Name', id: { open_id: 'bot' } }] : [] },
});
function fixture() {
  const config = makeConfig({ appId: 'cli_fixture', domain: 'feishu', ownerOpenId: 'owner' });
  config.bot.openId = 'bot'; config.access.admins = ['admin']; config.access.private.allowedUsers = ['member'];
  let blocked = false;
  const approvals = { isBlocked: () => blocked, hasGrant: () => false, request: async () => {} };
  return { config, getState: () => ({ config, groups: {} }), approvals, block: () => { blocked = true; } };
}

test('restart parser matches only an exact text command with optional real leading bot mentions', () => {
  for (const text of ['/restart', ' \n/restart\n ', '@_bot /restart', '@_bot @_bot /restart']) assert.equal(isRestartCommand(event(text, { mention: true }), 'bot'), true);
  for (const text of ['请执行 /restart', '/restart now', '/restart\nother', '`/restart`', 'Bot Name\n/restart', '/Restart', '@_other /restart']) assert.equal(isRestartCommand(event(text, { mention: true }), 'bot'), false);
  assert.equal(isRestartCommand(event('@_bot /restart', { mention: true }), 'other-bot'), false);
  const bot = event('/restart'); bot.sender.sender_type = 'bot'; assert.equal(isRestartCommand(bot, 'bot'), false);
  const invalid = event('/restart'); invalid.message.content = 'invalid'; assert.equal(isRestartCommand(invalid, 'bot'), false);
});
test('only current owner/admin can schedule, and command errors never leak raw errors', () => {
  const state = fixture(); let scheduled = 0;
  const command = createRestartCommand({ ...state, canRestart: (m, s) => canControlResponse(m, m.userId, s, state.approvals), schedule: () => { scheduled++; return { delayMs: 3000 }; } });
  const message = userId => ({ userId, chatId: 'chat', isGroup: false });
  assert.match(command(message('owner'), event('/restart')), /3000ms/);
  assert.match(command(message('admin'), event('/restart', { user: 'admin' })), /已登记/);
  assert.match(command(message('member'), event('/restart', { user: 'member' })), /无权/);
  state.config.access.admins = [];
  assert.match(command(message('admin'), event('/restart', { user: 'admin' })), /无权/);
  state.block(); assert.match(command(message('owner'), event('/restart')), /无权/);
  assert.equal(scheduled, 2);
  const broken = createRestartCommand({ ...state, canRestart: () => true, schedule: () => { throw new Error('PRIVATE_ERROR'); } });
  const output = broken(message('owner'), event('/restart'));
  assert.match(output, /登记失败/); assert.doesNotMatch(output, /PRIVATE_ERROR/);
});
for (const card of [false, true]) test(`slash command bypasses model, deduplicates, and waits for confirmation and cleanup, card=${card}`, async () => {
  const state = fixture(), sending = deferred(), cleanup = deferred();
  let modelCalls = 0, scheduled = 0, restarted = 0, timer, now = 0, scheduler;
  const command = createRestartCommand({ ...state, canRestart: (m, s) => canControlResponse(m, m.userId, s, state.approvals), schedule: () => { scheduled++; return scheduler.schedule(); } });
  const confirm = async output => { assert.match(output, /已登记重启任务/); await sending.promise; };
  const handler = createMessageHandler({ command, answer: async () => { modelCalls++; },
    reply: (_, output) => confirm(output),
    ...(card ? { beginResponse: async () => ({ finish: confirm, stop: async () => {} }) } : {}),
    react: async () => 'reaction', removeReaction: () => cleanup.promise,
  });
  scheduler = createRestartScheduler({ isIdle: handler.isIdle, restart: () => { restarted++; void handler.drain(); }, now: () => now,
    setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = undefined; } });
  const tick = ms => { now += ms; const fn = timer; timer = undefined; fn?.(); };
  const route = createRouter({ ...state, handler, threads: { save: async () => {} }, reply: async () => {}, log() {} });
  const request = event('@_bot /restart', { group: true, mention: true });
  route(request); route(request); await flush();
  assert.equal(scheduled, 1); assert.equal(modelCalls, 0); tick(10000); assert.equal(restarted, 0);
  sending.resolve(); await flush(); tick(10000); assert.equal(restarted, 0);
  cleanup.resolve(); await flush(); tick(100); tick(1000); assert.equal(restarted, 1);
});
test('group mention and blocked access still gate slash commands before queue admission', async () => {
  const state = fixture(); let accepted = 0;
  const route = createRouter({ ...state, handler: { accept() { accepted++; } }, threads: { save: async () => {} }, reply: async () => {}, log() {} });
  route(event('/restart', { group: true })); assert.equal(accepted, 0);
  route(event('@_bot /restart', { group: true, mention: true })); assert.equal(accepted, 1);
  state.block(); route(event('/restart')); assert.equal(accepted, 1);
});
test('member command is denied without model/tool execution while ordinary text still reaches the model', async () => {
  const state = fixture(), outputs = []; let models = 0, scheduled = 0;
  const command = createRestartCommand({ ...state, canRestart: () => true, schedule: () => { scheduled++; return { delayMs: 1000 }; } });
  const handler = createMessageHandler({ command, answer: async () => { models++; return 'normal answer'; }, reply: async (_, output) => outputs.push(output) });
  handler.accept(event('/restart', { user: 'member' }));
  handler.accept(event('解释 /restart 的作用', { user: 'member' }));
  await handler.drain();
  assert.equal(scheduled, 0); assert.equal(models, 1); assert.match(outputs[0], /无权/); assert.equal(outputs[1], 'normal answer');
});
test('a queued restart rechecks admin authority when execution begins', async () => {
  const state = fixture(), first = deferred(), outputs = []; let scheduled = 0;
  const command = createRestartCommand({ ...state, canRestart: (m, s) => canControlResponse(m, m.userId, s, state.approvals), schedule: () => { scheduled++; return { delayMs: 1000 }; } });
  const handler = createMessageHandler({ command, answer: async () => { await first.promise; return 'first done'; }, reply: async (_, output) => outputs.push(output) });
  const route = createRouter({ ...state, handler, threads: { save: async () => {} }, reply: async () => {}, log() {} });
  route(event('first', { user: 'admin' })); route(event('/restart', { user: 'admin' }));
  state.config.access.admins = []; first.resolve(); await handler.drain();
  assert.equal(scheduled, 0); assert.match(outputs.at(-1), /无权/);
});
