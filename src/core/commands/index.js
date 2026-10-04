export { parseDebugDuration } from './duration.js';
import { isAdmin } from '../access/index.js';
export function createRestartCommand({ getState, canRestart, schedule, log = () => {} }) {
  return message => {
    const state = getState();
    if (!isAdmin(state.config, message.userId) || !canRestart(message, state)) return '无权重启网关：仅当前 owner 或管理员可执行 /restart。';
    try {
      const job = schedule();
      return `已登记重启任务。等本条确认及所有已接收回复、收尾操作完成后，空闲延迟 ${job.delayMs}ms 再重启。`;
    } catch {
      log('restart_command_failed');
      return '重启任务登记失败，当前服务未被强制重启，请检查服务版本和运行状态。';
    }
  };
}
