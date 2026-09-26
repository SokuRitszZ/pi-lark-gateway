import { RESTART_EXIT_CODE } from '../restart/index.js';

export function superviseCommand({ spawnChild, restartable = false, signals = process, onExit, onError = () => {} }) {
  let child, stopping = false, finished = false;
  const forward = signal => { stopping = true; if (child && !child.killed) child.kill(signal); };
  const onInt = () => forward('SIGINT'), onTerm = () => forward('SIGTERM');
  function finish(code) {
    if (finished) return;
    finished = true;
    signals.off('SIGINT', onInt); signals.off('SIGTERM', onTerm);
    onExit(code);
  }
  function launch() {
    try { child = spawnChild(); }
    catch { onError(); finish(1); return; }
    child.once('error', () => { onError(); finish(1); });
    child.once('close', (code, signal) => {
      if (finished) return;
      if (restartable && !stopping && code === RESTART_EXIT_CODE) launch();
      else finish(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  }
  signals.on('SIGINT', onInt); signals.on('SIGTERM', onTerm);
  launch();
}
