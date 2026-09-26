import { AsyncLocalStorage } from 'node:async_hooks';

const requests = new AsyncLocalStorage();
export const withResourceSignal = (signal, work) => requests.run(signal, work);

// Do not mutate the SDK's shared Axios instance. Scope cancellation to this API
// operation, including one that resumes after a delayed token lookup.
export function resourceHttpInstance(http) {
  return { ...http, request(options) {
    const signal = requests.getStore();
    return http.request(signal ? { ...options, signal, timeout: 30000 } : options);
  } };
}
