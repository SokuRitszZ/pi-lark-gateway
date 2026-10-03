import * as clack from '@clack/prompts';

export class UserCancelled extends Error {
  constructor() { super('cli_cancelled'); this.code = 'CLI_CANCELLED'; }
}

// Keep the UI boundary injectable; business workflows never depend on ANSI/TTY.
export function createUI(prompts = clack, interactive = process.stdin.isTTY && process.stdout.isTTY, signal) {
  const check = () => { if (signal?.aborted) throw new UserCancelled(); if (!interactive) throw new Error('invalid_config:interactive_terminal_required'); };
  const result = value => { if (prompts.isCancel(value)) throw new UserCancelled(); return value; };
  return {
    intro: title => { check(); prompts.intro(title); },
    outro: text => prompts.outro(text),
    info: text => prompts.log.info(text),
    note: (text, title) => prompts.note(text, title),
    cancel: () => prompts.cancel('操作已取消；已保存的配置会保留，未确认身份不会授权。'),
    async select(options) { check(); return result(await prompts.select({ ...options, signal })); },
    async ask(message, secret = false, options = {}) {
      check();
      if (secret) return result(await prompts.password({ message, mask: '•', validate: options.validate, signal }));
      if (options.kind === 'confirm') return result(await prompts.confirm({ message, initialValue: options.initialValue ?? false, signal })) ? 'y' : 'n';
      if (options.kind === 'select') return result(await prompts.select({ message, options: options.options, initialValue: options.initialValue, signal }));
      if (options.kind === 'multiselect') return result(await prompts.multiselect({ message, options: options.options, required: false, signal })).join(',');
      return result(await prompts.text({ message, defaultValue: options.defaultValue, placeholder: options.defaultValue || options.placeholder,
        validate: options.validate, signal }));
    },
    async progress(label, task) {
      check();
      let cancelled = false;
      const spinner = prompts.spinner({ signal, onCancel: () => { cancelled = true; }, cancelMessage: '正在取消，等待连接收尾…' });
      spinner.start(label);
      try {
        const value = await task();
        if (cancelled) { await value?.close?.(); throw new UserCancelled(); }
        spinner.stop('QQ 接入已就绪'); return value;
      } catch (error) {
        if (cancelled) throw new UserCancelled();
        spinner.error('连接未完成，请检查凭据、网络及平台配置'); throw error;
      }
    },
  };
}
