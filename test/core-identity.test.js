import test from 'node:test';
import assert from 'node:assert/strict';
import { identityHeader } from '../src/core/identity/index.js';
import { createGatewayIdentityResolver } from '../src/adapters/lark/identity/index.js';

test('PIGateway permits empty, multiple and platform-native identity branches', () => {
  for (const identity of [{}, { Lark: { sender: { open_id: 'ou_x' } } }, { QQ: { user_openid: 'qq_x' } },
    { Lark: { sender: { open_id: 'ou_x' } }, QQ: { user_openid: 'qq_x' } }]) {
    const header = identityHeader(identity);
    const json = header.split('<gateway_sender_identity>\n')[1].split('\n</gateway_sender_identity>')[0];
    assert.deepEqual(JSON.parse(json), identity);
  }
});
test('Lark resolver produces PIGateway and rejects a mismatched directory record', async () => {
  const resolve = createGatewayIdentityResolver({ getUser: async () => ({ open_id: 'ou_other', name: 'wrong' }) });
  const result = await resolve({ id: 'm', userId: 'ou_real', chatId: 'c', isGroup: true });
  assert.equal(result.Lark.sender.open_id, 'ou_real');
  assert.equal(result.Lark.profile.name, null);
  assert.equal(result.QQ, undefined);
});
