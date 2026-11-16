import { AsyncLocalStorage } from 'node:async_hooks';
import { createBus, installNFBus } from '@softarc/native-federation-communication/internal';

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
  const requestBus = Object.freeze({
    protocol: 1,
    version: createBus().version,
    emit: (...args) => call('emit', args),
    on: (...args) => call('on', args),
    peek: (...args) => call('peek', args),
  });
  // a bus installed earlier would be shared by every request, so refuse to run on top of it
  if (installNFBus(requestBus) !== requestBus)
    throw new Error('__NF_BUS__ already holds another bus.');
}

export const withRequestBus = handle => requests.run(createBus(), handle);
