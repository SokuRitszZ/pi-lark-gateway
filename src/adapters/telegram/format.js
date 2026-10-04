import MarkdownIt from 'markdown-it';
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Entities avoid MarkdownV2/HTML injection and keep offsets in Telegram's UTF-16 units.
export function formatText(input, limit = 3900) {
  let text = ''; const entities = [], stack = [];
  const span = (type, value, extra = {}) => { const offset = text.length; text += value; if (value.length) entities.push({ type, offset, length: value.length, ...extra }); };
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = tokens => {
    for (const t of tokens) {
      if (t.type === 'inline') visit(t.children || []);
      else if (t.type === 'text' || t.type === 'html_inline' || t.type === 'html_block') text += t.content;
      else if (t.type === 'code_inline') span('code', t.content);
      else if (t.type === 'fence' || t.type === 'code_block') { newline(); span('pre', t.content); newline(); }
      else if (['softbreak', 'hardbreak'].includes(t.type)) text += '\n';
      else if (t.type === 'image') text += t.content || '[图片]';
      else if (t.type === 'list_item_open') { newline(); text += '• '; }
      else if (['paragraph_close', 'heading_close', 'list_item_close', 'tr_close'].includes(t.type)) newline();
      else if (t.type === 'td_close' || t.type === 'th_close') text += '  ';
      else if (t.type === 'hr') { newline(); text += '───\n'; }
      else if (['strong_open', 'em_open', 's_open', 'link_open'].includes(t.type)) {
        const type = { strong_open: 'bold', em_open: 'italic', s_open: 'strikethrough', link_open: 'text_link' }[t.type];
        const url = t.attrGet('href');
        stack.push({ type, offset: text.length, ...(type === 'text_link' ? { url } : {}) });
      } else if (['strong_close', 'em_close', 's_close', 'link_close'].includes(t.type)) {
        const e = stack.pop();
        if (e && text.length > e.offset && (e.type !== 'text_link' || /^https?:\/\//i.test(e.url || ''))) entities.push({ ...e, length: text.length - e.offset });
      }
    }
  };
  visit(parser.parse(String(input || ''), {}));
  text = text.trimEnd() || '正在处理…';
  const clipped = text.length > limit;
  let cutoff = Math.min(limit, text.length);
  if (cutoff < text.length && /[\uD800-\uDBFF]/.test(text[cutoff - 1])) cutoff--;
  const valid = entities.filter(e => e.offset < cutoff).map(e => ({ ...e, length: Math.min(e.length, cutoff - e.offset) })).filter(e => e.length > 0);
  const code = valid.filter(e => ['code', 'pre'].includes(e.type));
  const compatible = valid.filter(e => code.includes(e) || !code.some(c => e.offset < c.offset + c.length && e.offset + e.length > c.offset));
  return { text: text.slice(0, cutoff) + (clipped ? '\n[回复过长，已截断；请要求分段继续。]' : ''), entities: compatible };
}
export function formatPages(input, limit = 3900, maxPages = 12) {
  const all = formatText(input, limit * maxPages - 100), pages = [];
  let start = 0;
  while (start < all.text.length && pages.length < maxPages) {
    let end = Math.min(start + limit, all.text.length);
    if (end < all.text.length && /[\uD800-\uDBFF]/.test(all.text[end - 1])) end--;
    pages.push({ text: all.text.slice(start, end), entities: all.entities.filter(e => e.offset < end && e.offset + e.length > start)
      .map(e => ({ ...e, offset: Math.max(start, e.offset) - start, length: Math.min(end, e.offset + e.length) - Math.max(start, e.offset) })) });
    start = end;
  }
  return pages;
}
