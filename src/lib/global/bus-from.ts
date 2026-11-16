import type { Bus } from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, noop } from '../bus/arguments.js';
import { VERSION } from '../bus/create-bus.js';

let warned = false;

function dropped(channel: unknown): undefined {
  assertChannel(channel);
  if (warned) return;
  warned = true;
  console.warn(
    '[native-federation-communication] No bus is available here, so this call is dropped. Install ' +
      "one with '@softarc/native-federation-communication/quickstart' or via " +
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

export function busFrom(get: () => NativeFederationBus | undefined): Bus {
  const current = () => (get() ?? inert) as Bus;
  return Object.freeze({
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
}
