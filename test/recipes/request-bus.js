import { AsyncLocalStorage } from 'node:async_hooks';
import { createBus } from '@softarc/native-federation-communication';

const requests = new AsyncLocalStorage();

export function installRequestBus() {
  let warned = false;
  const call = (method, args) => {
    const scoped = requests.getStore();
    if (scoped) return scoped[method](...args);
    // a throwaway bus checks the arguments like any bus and keeps nothing
    const result = createBus()[method](...args);
    if (!warned) console.warn('__NF_BUS__ was used outside a request: the call was ignored.');
    warned = true;
    return result;
  };
  globalThis.__NF_BUS__ = Object.freeze({
    protocol: 1,
    version: createBus().version,
    emit: (...args) => call('emit', args),
    on: (...args) => call('on', args),
    peek: (...args) => call('peek', args),
  });
}

export const withRequestBus = handle => requests.run(createBus(), handle);
