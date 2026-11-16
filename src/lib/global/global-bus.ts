import type { Bus } from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, noop } from '../bus/arguments.js';
import { VERSION } from '../bus/create-bus.js';
import { getNFBus } from './slot.js';

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
