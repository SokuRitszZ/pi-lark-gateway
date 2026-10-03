import path from 'node:path';
import { writeJson } from '../../../core/storage/index.js';

export function createMetadata(client, log) {
  return {
    async probeBot(base) {
      let info = {};
      try {
        const result = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' });
        if (result.code === 0) {
          const bot = result.bot || result.data?.bot || {};
          info = { name: bot.app_name || bot.bot_name || null, openId: bot.open_id || null };
          await writeJson(path.join(base, 'bot-meta.json'), info);
        }
      } catch { log('bot_metadata_probe_failed'); }
      return info;
    },
    async getChatInfo(chatId) {
      const url = `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(chatId)}`;
      try {
        const result = await client.im.v1.chat.get({ path: { chat_id: chatId } });
        return { name: result.code === 0 ? result.data?.name : undefined, url };
      } catch { log('chat_name_lookup_failed'); return { url }; }
    },
  };
}
