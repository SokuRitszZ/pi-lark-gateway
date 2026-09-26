import { responseCard } from './card.js';

// Account for double JSON encoding, title and controls; never split a code point.
export function cardPages(title, text, state, controlId) {
  const chars = Array.from(text), pages = [];
  const card = (content, index) => responseCard(index ? `${title}（续）` : title, content, state, index ? undefined : controlId);
  const fits = value => Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(value) }), 'utf8') <= 28 * 1024;
  for (let offset = 0; offset < chars.length || !pages.length;) {
    const index = pages.length;
    const rest = card(chars.slice(offset).join(''), index);
    if (fits(rest)) { pages.push(rest); break; }
    let low = 0, high = chars.length - offset;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (fits(card(chars.slice(offset, offset + count).join(''), index))) low = count;
      else high = count - 1;
    }
    if (!low) throw new Error('response_card_header_too_large');
    pages.push(card(chars.slice(offset, offset + low).join(''), index));
    offset += low;
  }
  return pages;
}
