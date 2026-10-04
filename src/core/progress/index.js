import { createTimeline } from './timeline.js';
export { createTimeline };

// Coalesce progress updates; final edit waits for all in-flight edits.
export function createProgress({ edit, interval = 1200, log = () => {}, retainTranscript = false }) {
  const calls = [], timeline = retainTranscript ? createTimeline() : null;
  let timer, closed = false, animate = false, chain = Promise.resolve();
  const render = () => timeline ? timeline.render() || '正在思考…' : '正在思考…\n' + (calls.length ? '最近工具调用（最多 10 条）：\n' + calls.map(c => `${c.status} ${c.name}`).join('\n') : '暂无工具调用');
  function enqueue(text, options) {
    chain = chain.then(() => edit(text, options)).catch(() => log('progress_update_failed'));
    return chain;
  }
  return {
    event(event) {
      if (closed) return;
      if (timeline) {
        if (!timeline.event(event)) return;
      } else if (event.type === 'tool_execution_start') {
        calls.push({ id: event.toolCallId, name: String(event.toolName).replace(/[\r\n]/g, ' ').slice(0, 100), status: '⏳' });
        if (calls.length > 10) calls.shift();
      } else if (event.type === 'tool_execution_end') {
        const call = calls.find(c => c.id === event.toolCallId);
        if (call) call.status = event.isError ? '❌' : '✅';
      } else if (!['agent_start', 'intent_title'].includes(event.type)) return;
      animate = event.type === 'message_update'
        || (['message_start', 'message_end'].includes(event.type) && event.message?.content?.some(block => block.type === 'text' && block.text));
      if (!timer) timer = setTimeout(() => { timer = undefined; void enqueue(render(), { animate }); }, interval);
    },
    async finish(text, options) {
      closed = true; clearTimeout(timer);
      await chain;
      // Propagate final-edit failure so caller can provide a fallback reply.
      await edit(timeline ? timeline.finish(text, options) : text, { animate: !options?.terminal });
    },
    async stop() { closed = true; clearTimeout(timer); await chain; },
  };
}
