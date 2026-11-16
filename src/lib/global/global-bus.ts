import type { Bus } from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, noop } from '../bus/arguments.js';
import { VERSION } from '../bus/create-bus.js';

type Slot = { __NF_BUS__?: Bus };

let warned = false;

function dropped(channel: unknown): undefined {
  assertChannel(channel);
  if (warned) return;
  warned = true;
  console.warn(
    '[native-federation-communication] No bus is installed, so this bus drops every value. Import ' +
      "'@softarc/native-federation-communication/quickstart' or install one via " +
      "'@softarc/native-federation-communication/internal'."
  );
}

const inert: Bus = {
  protocol: 1,
  version: VERSION,
  emit: dropped,
  on: (channel: string, listener: unknown) => (assertListener(listener), dropped(channel), noop),
  peek: dropped,
};

export const getNFBus = (loc: object = globalThis): Bus | undefined => (loc as Slot).__NF_BUS__;

// A classic script's `var __NF_BUS__;` leaves a non-configurable slot that only assignment can fill.
export function installNFBus(bus: Bus, loc: object = globalThis): Bus {
  if (getNFBus(loc) === undefined) {
    const slot = { value: bus, writable: false, enumerable: false, configurable: true };
    if (!Reflect.defineProperty(loc, '__NF_BUS__', slot)) (loc as Slot).__NF_BUS__ = bus;
  }
  return getNFBus(loc) as Bus;
}

const current = (): Bus => getNFBus() ?? inert;

export const bus: Bus = Object.freeze({
  get protocol() {
    return current().protocol;
  },
  get version() {
    return current().version;
  },
  emit: (channel, value, options) => current().emit(channel, value, options),
  on: (channel, listener, options) => current().on(channel, listener, options),
  peek: channel => current().peek(channel),
  get tap() {
    return current().tap;
  },
} satisfies Bus);
