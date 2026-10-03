export function createCards(client) {
  return {
    async sendCard(owner, card) {
      const result = await client.im.v1.message.create({ params: { receive_id_type: 'open_id' }, data: {
        receive_id: owner, msg_type: 'interactive', content: JSON.stringify(card),
      } });
      if (result.code !== 0 || !result.data?.message_id) throw new Error('approval_send_failed');
      return result.data.message_id;
    },
    async updateCard(id, card) {
      const result = await client.im.v1.message.patch({ path: { message_id: id }, data: { content: JSON.stringify(card) } });
      if (result.code !== 0) throw new Error('approval_update_failed');
    },
  };
}
