export { createRestartControl, requestRestart, restartSocketPath } from './control.js';
export { createRestartCommand, isRestartCommand } from './command.js';
export { createRestartScheduler } from './scheduler.js';
// Non-zero intentional exit: launchd SuccessfulExit=false and systemd
// Restart=on-failure both respawn; the npm CLI supervisor recognizes it too.
export const RESTART_EXIT_CODE = 75;
