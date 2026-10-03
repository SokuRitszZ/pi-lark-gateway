import { createStreamingCards } from './card-stream.js';

export function createReplies(client, threads, log) {
  async function sendReply(message, text) {
    const result = await client.im.v1.message.reply({ path: { message_id: message.id }, data: {
      msg_type: 'text', content: JSON.stringify({ text }),
      ...(message.isGroup ? { reply_in_thread: true } : {}),
    } });
    if (result.code !== 0 || !result.data?.message_id) throw new Error('send_failed');
    if (message.isGroup && result.data.thread_id) {
      threads.roots.set(`${message.chatId}:${result.data.thread_id}`, message.root);
      await threads.save().catch(() => log('thread_mapping_save_failed'));
    }
    return result.data.message_id;
  }
  async function reply(message, text) {
    const characters = Array.from(text);
    for (let i = 0; i < characters.length; i += 1500) await sendReply(message, characters.slice(i, i + 1500).join(''));
  }
  async function edit(messageId, text) {
    const result = await client.im.v1.message.update({ path: { message_id: messageId }, data: {
      msg_type: 'text', content: JSON.stringify({ text }),
    } });
    if (result.code !== 0) { log(`edit_failed_code_${Number(result.code)}`); throw new Error('edit_failed'); }
  }
  async function sendCardReply(message, card, { uuid } = {}) {
    const result = await client.im.v1.message.reply({ path: { message_id: message.id }, data: {
      msg_type: 'interactive', content: JSON.stringify(card), ...(uuid ? { uuid } : {}),
      ...(message.isGroup ? { reply_in_thread: true } : {}),
    } });
    if (result.code !== 0 || !result.data?.message_id) throw Object.assign(new Error('card_send_failed'), {
      cardSendRejected: Number.isInteger(result.code) && result.code !== 0,
    });
    if (message.isGroup && result.data.thread_id) {
      threads.roots.set(`${message.chatId}:${result.data.thread_id}`, message.root);
      await threads.save().catch(() => log('thread_mapping_save_failed'));
    }
    return result.data.message_id;
  }
  async function editCard(id, card) {
    const result = await client.im.v1.message.patch({ path: { message_id: id }, data: { content: JSON.stringify(card) } });
    if (result.code !== 0) throw new Error('card_edit_failed');
  }
  async function sendResourceReply(message, type, content, { uuid } = {}) {
    const result = await client.im.v1.message.reply({ path: { message_id: message.id }, data: {
      msg_type: type, content: JSON.stringify(content), uuid,
      ...(message.isGroup ? { reply_in_thread: true } : {}),
    } });
    if (result.code !== 0 || !result.data?.message_id) throw new Error('resource_send_failed');
    if (message.isGroup && result.data.thread_id) {
      threads.roots.set(`${message.chatId}:${result.data.thread_id}`, message.root);
      await threads.save().catch(() => log('thread_mapping_save_failed'));
    }
    return result.data.message_id;
  }
  return { sendReply, reply, edit, sendCardReply, editCard, sendResourceReply,
    createCardStream: message => createStreamingCards({ client, log,
      send: (card, options) => sendCardReply(message, card, options), edit: editCard,
    }),
  };
}
