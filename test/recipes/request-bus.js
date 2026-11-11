import { AsyncLocalStorage } from 'node:async_hooks';
import { createBus } from '@softarc/native-federation-communication';

const requests = new AsyncLocalStorage();

export function installRequestBus() {
  let warned = false;
  const current = () => {
    const scoped = requests.getStore();
    if (!scoped && !warned) {
      warned = true;
      console.warn('__NF_BUS__ was used outside a request: the call was ignored.');
    }
    return scoped;
  };
  globalThis.__NF_BUS__ = Object.freeze({
    protocol: 1,
    version: createBus().version,
    emit: (channel, value, options) => current()?.emit(channel, value, options),
    on: (channel, listener, options) => current()?.on(channel, listener, options) ?? (() => {}),
    peek: channel => current()?.peek(channel),
  });
}

export const withRequestBus = handle => requests.run(createBus(), handle);
