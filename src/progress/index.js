// Coalesce progress updates; final edit waits for all in-flight edits.
export function createProgress({ edit, interval = 1200, log = () => {} }) {
  const calls = [];
  let timer, closed = false, chain = Promise.resolve();
  const render = () => '正在思考…\n' + (calls.length ? '最近工具调用（最多 10 条）：\n' + calls.map(c => `${c.status} ${c.name}`).join('\n') : '暂无工具调用');
  function enqueue(text) {
    chain = chain.then(() => edit(text)).catch(() => log('progress_update_failed'));
    return chain;
  }
  return {
    event(event) {
      if (closed) return;
      if (event.type === 'tool_execution_start') {
        calls.push({ id: event.toolCallId, name: String(event.toolName).replace(/[\r\n]/g, ' ').slice(0, 100), status: '⏳' });
        if (calls.length > 10) calls.shift();
      } else if (event.type === 'tool_execution_end') {
        const call = calls.find(c => c.id === event.toolCallId);
        if (call) call.status = event.isError ? '❌' : '✅';
      } else if (!['agent_start', 'intent_title'].includes(event.type)) return;
      if (!timer) timer = setTimeout(() => { timer = undefined; void enqueue(render()); }, interval);
    },
    async finish(text) {
      closed = true; clearTimeout(timer);
      await chain;
      // Propagate final-edit failure so caller can provide a fallback reply.
      await edit(text);
    },
    async stop() { closed = true; clearTimeout(timer); await chain; },
  };
}
