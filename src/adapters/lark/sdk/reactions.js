export function createReactions(client, log) {
  return {
    async react(message, emoji) {
      const result = await client.im.v1.messageReaction.create({
        path: { message_id: message.id }, data: { reaction_type: { emoji_type: emoji } },
      });
      if (result.code !== 0) { log(`reaction_failed_code_${Number(result.code)}`); throw new Error('reaction_failed'); }
      log('reaction_added');
      return result.data?.reaction_id;
    },
    async removeReaction(message, reactionId) {
      const result = await client.im.v1.messageReaction.delete({ path: { message_id: message.id, reaction_id: reactionId } });
      if (result.code !== 0) { log(`reaction_remove_failed_code_${Number(result.code)}`); throw new Error('reaction_remove_failed'); }
      log('reaction_removed');
    },
  };
}
