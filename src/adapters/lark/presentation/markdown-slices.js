// Preserve fenced-code context across independently rendered card pages.
// Offsets are Unicode code points, matching cardPages' byte-budget search.
export function markdownSlices(text) {
  const chars = Array.from(text), spans = [], markers = [];
  let offset = 0, active;
  for (const raw of text.matchAll(/[^\n]+\n?|\n/g)) {
    const line = raw[0], end = offset + Array.from(line).length;
    const match = line.replace(/\r?\n$/, '').match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
    if (match) {
      const fence = match[1], info = match[2];
      if (!active && !(fence[0] === '`' && info.includes('`'))) {
        active = { start: end, end: Infinity, opening: line.endsWith('\n') ? line : `${line}\n`, fence };
        spans.push(active); markers.push({ start: offset, end });
      } else if (active && fence[0] === active.fence[0] && fence.length >= active.fence.length && !info.trim()) {
        active.end = end; active = undefined; markers.push({ start: offset, end });
      }
    }
    offset = end;
  }
  const inside = pos => spans.find(span => span.start <= pos && pos < span.end);
  return {
    chars,
    safeEnd(end) {
      const marker = markers.find(range => range.start < end && end < range.end);
      return marker ? marker.start : end;
    },
    slice(start, end) {
      const before = inside(start), after = inside(end);
      const prefix = before ? before.opening : '';
      const suffix = after ? `${chars[end - 1] === '\n' ? '' : '\n'}${after.fence}\n` : '';
      return prefix + chars.slice(start, end).join('') + suffix;
    },
  };
}
