import type { Bus } from '../domain/bus/bus.contract.js';
import { createBus, noop, VERSION } from '../bus/create-bus.js';

const inert: Bus = Object.freeze({
  protocol: 1,
  version: VERSION,
  emit: noop,
  on: () => noop,
  peek: () => undefined,
});

let fallback: Bus | undefined;

const isBus = (slot: unknown): slot is Bus => {
  const protocol: unknown = (slot as Partial<Bus> | null | undefined)?.protocol;
  return typeof protocol === 'number' && protocol >= 1;
};

function foreignFallback(): Bus {
  if (!fallback) {
    fallback = createBus();
    console.warn(
      '[native-federation-communication] globalThis.__NF_BUS__ holds something that is not a bus. ' +
        'This copy uses a private bus, so its channels do not reach the other copies on the page.'
    );
  }
  return fallback;
}

function install(): Bus {
  const created = createBus();
  Object.defineProperty(globalThis, '__NF_BUS__', {
    value: created,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  return created;
}

export function getGlobalBus(): Bus {
  // no window: SSR or worker, never share retained values across requests
  if (typeof window === 'undefined') return inert;
  const slot: unknown = globalThis.__NF_BUS__;
  if (isBus(slot)) return slot;
  return slot === undefined ? install() : foreignFallback();
}

export const bus: Bus = Object.freeze({
  get protocol() {
    return getGlobalBus().protocol;
  },
  get version() {
    return getGlobalBus().version;
  },
  emit: (channel, value, options) => getGlobalBus().emit(channel, value, options),
  on: (channel, listener, options) => getGlobalBus().on(channel, listener, options),
  peek: channel => getGlobalBus().peek(channel),
} satisfies Bus);
