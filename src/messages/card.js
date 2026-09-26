export const CARD_COLORS = { waiting: 'grey', thinking: 'blue', success: 'green', error: 'red', stopped: 'orange' };
export function responseCard(title, text, state, controlId, images = []) {
  return {
    // Headings, quotes and tables require Card JSON 2.0, not just tag: markdown.
    schema: '2.0',
    config: { width_mode: 'default', update_multi: true },
    header: { template: CARD_COLORS[state], title: { tag: 'plain_text', content: title || '正在整理意图…' } },
    body: { elements: [{ tag: 'markdown', content: text }, ...images.map(image => ({ tag: 'img', img_key: image.key,
      alt: { tag: 'plain_text', content: image.name }, scale_type: 'fit_horizontal', compact_width: true, preview: true })), ...(state === 'thinking' && controlId ? [
      { tag: 'form', name: 'interrupt', elements: [
        { tag: 'column_set', flex_mode: 'none', horizontal_spacing: 'small', columns: [
          { tag: 'column', width: 'auto', vertical_align: 'center', elements: [
            { tag: 'button', name: 'stop', type: 'danger', form_action_type: 'submit', text: { tag: 'plain_text', content: '停止' },
              behaviors: [{ type: 'callback', value: { kind: 'response_control', id: controlId, action: 'stop' } }] },
          ] },
          { tag: 'column', width: 'weighted', weight: 1, vertical_align: 'center', elements: [
            { tag: 'input', name: 'instruction', width: 'fill', placeholder: { tag: 'plain_text', content: '输入要插入的指令…' } },
          ] },
          { tag: 'column', width: 'auto', vertical_align: 'center', elements: [
            { tag: 'button', name: 'interrupt_submit', type: 'primary', form_action_type: 'submit',
              text: { tag: 'plain_text', content: '打断' },
              behaviors: [{ type: 'callback', value: { kind: 'response_control', id: controlId, action: 'steer' } }] },
          ] },
        ] },
      ] },
    ] : [])] },
  };
}
