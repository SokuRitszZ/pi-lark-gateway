const literal = text => String(text).replace(/([\\`*_\[\]<>])/g, '\\$1');
export function nextStepsText(view) {
  const selected = Number.isInteger(view.selectedIndex);
  return '**下一步建议**\n\n' + view.options.map((option, index) =>
    `${selected && index === view.selectedIndex ? '✅ ' : ''}**${index + 1}. ${literal(option.title)}**\n${literal(option.detail)}`).join('\n\n')
    + (selected ? `\n\n✅ 已选择：${literal(view.options[view.selectedIndex].title)}` : '\n\n选择一个选项后，将沿用当前上下文继续。')
    + (view.unavailable ? '\n\n⚠️ 后续请求未启动：当前权限或服务容量不允许，请检查后重新发送请求。' : '');
}
