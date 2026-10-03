// Pi 0.86.1's bundled provider converters consume flat { data, mimeType },
// despite its SDK docs showing nested { source: { data, mediaType } }.
// Keep compatibility at the SDK read boundary; never rewrite original JSONL.
const adaptedManagers = new WeakSet();
const valid = (mime, data) => typeof mime === 'string' && /^image\/[a-z0-9.+-]+$/i.test(mime)
  && typeof data === 'string' && data.length > 0;

export function runtimeImage(block) {
  if (block?.type !== 'image') return block;
  if (valid(block.mimeType, block.data)) return block;
  if (block.source?.type === 'base64' && valid(block.source.mediaType, block.source.data)) {
    const { source, ...rest } = block;
    return { ...rest, mimeType: source.mediaType, data: source.data };
  }
  throw Object.assign(new Error('image_input_invalid'), { code: 'IMAGE_INPUT_INVALID' });
}

export function runtimeMessages(messages) {
  let changed = false;
  const normalized = messages.map(message => {
    if (!Array.isArray(message.content)) return message;
    const content = message.content.map(runtimeImage);
    if (content.every((block, index) => block === message.content[index])) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? normalized : messages;
}

export function enableImageCompatibility(manager) {
  if (adaptedManagers.has(manager)) return manager;
  const build = manager.buildSessionContext.bind(manager);
  manager.buildSessionContext = (...args) => {
    const context = build(...args), messages = runtimeMessages(context.messages);
    return messages === context.messages ? context : { ...context, messages };
  };
  adaptedManagers.add(manager);
  return manager;
}
