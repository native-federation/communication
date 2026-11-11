import type { Bus } from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, createBus, noop, VERSION } from '../bus/create-bus.js';

const METHODS = ['emit', 'on', 'peek'] as const;

let fallback: Bus | undefined;
let warnedInert = false;

function warnInert(): void {
  if (warnedInert) return;
  warnedInert = true;
  console.warn(
    '[native-federation-communication] No bus is installed outside a browser page, so this bus drops ' +
      'every value. On a server, install a request-scoped bus at boot (see "Outside a browser" in the ' +
      'docs). Only in a single-user process: globalThis.__NF_BUS__ ??= createBus().'
  );
}

const inert: Bus = Object.freeze({
  protocol: 1,
  version: VERSION,
  emit: (channel: string) => {
    assertChannel(channel);
    warnInert();
  },
  on: (channel: string, listener: unknown) => {
    assertChannel(channel);
    assertListener(listener);
    warnInert();
    return noop;
  },
  peek: (channel: string) => {
    assertChannel(channel);
    warnInert();
    return undefined;
  },
});

const isBus = (slot: unknown): slot is Bus => {
  const candidate = slot as Record<string, unknown> | null | undefined;
  const protocol = candidate?.protocol;
  return (
    typeof protocol === 'number' &&
    protocol >= 1 &&
    METHODS.every(method => typeof candidate?.[method] === 'function')
  );
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
  try {
    Object.defineProperty(globalThis, '__NF_BUS__', {
      value: created,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // A classic script's `var __NF_BUS__;` makes the slot non-configurable, but still writable.
    Reflect.set(globalThis, '__NF_BUS__', created);
  }
  const slot: unknown = globalThis.__NF_BUS__;
  return isBus(slot) ? slot : foreignFallback();
}

// One realm per user: a browser page, not a server process (a shim may define `window` there).
const isPage = (): boolean => typeof window !== 'undefined' && window === globalThis;

export function getGlobalBus(): Bus {
  const slot: unknown = globalThis.__NF_BUS__;
  if (isBus(slot)) return slot;
  if (slot !== undefined) return foreignFallback();
  return isPage() ? install() : inert;
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
