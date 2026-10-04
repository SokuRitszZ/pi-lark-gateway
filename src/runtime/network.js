import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// Node's --use-env-proxy alone is not sufficient once SDK dependencies install
// their own Undici dispatcher. Apply after imports in each standalone runtime.
// Embedded extensions inherit their host's dispatcher instead of replacing it.
export function configureEnvironmentProxy() {
  const dispatcher = new EnvHttpProxyAgent();
  setGlobalDispatcher(dispatcher);
  return dispatcher;
}
