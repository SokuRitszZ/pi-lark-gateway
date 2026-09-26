import { responseCard } from './card.js';
import { markdownSlices } from './markdown-slices.js';

// Account for double JSON encoding, title and controls; never split a code point.
export function cardPages(title, text, state, controlId) {
  const markdown = markdownSlices(text), { chars } = markdown, pages = [];
  const card = (content, index) => responseCard(index ? `${title}（续）` : title, content, state, index ? undefined : controlId);
  const fits = value => Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(value) }), 'utf8') <= 28 * 1024;
  for (let offset = 0; offset < chars.length || !pages.length;) {
    const index = pages.length;
    const rest = card(markdown.slice(offset, chars.length), index);
    if (fits(rest)) { pages.push(rest); break; }
    let low = 0, high = chars.length - offset;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (fits(card(markdown.slice(offset, offset + count), index))) low = count;
      else high = count - 1;
    }
    const end = markdown.safeEnd(offset + low);
    const page = card(markdown.slice(offset, end), index);
    if (end <= offset || !fits(page)) throw new Error('response_card_header_too_large');
    pages.push(page);
    offset = end;
  }
  return pages;
}
