import { saveConfig } from '../config/index.js';
import { permissionsGuide } from './permissions.js';

// Shared completion path for both QR registration and manual credentials.
export async function finishSetup({ configPath, credentials, startCommand, output = console.log, save = saveConfig }) {
  await save(configPath, credentials);
  output(`\n关联完成。App ID：${credentials.appId}\n配置已保存：${configPath}（权限 600）`);
  if (!credentials.ownerOpenId) output('未取得用户 open_id，请在本地配置 access.owner。');
  output('密钥已独立保存。默认白名单审批：owner 直接使用，其他用户需 owner 审批；群聊需 @，工具默认关闭。');
  output(`\n${permissionsGuide(credentials.appId)}`);
  output(`\n完成上述权限、事件/回调、发布及可用范围检查后，运行 ${startCommand} 启动网关。`);
}
