import type { Bus, TapListener } from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, noop } from '../bus/arguments.js';
import { VERSION } from '../bus/create-bus.js';

let warned = false;

function dropped(channel: unknown): undefined {
  assertChannel(channel);
  if (warned) return;
  warned = true;
  console.warn(
    '[native-federation-communication] No bus is available here, so this call is dropped. Install ' +
      "one with '@softarc/native-federation-communication/install' or via " +
      "'@softarc/native-federation-communication/setup'."
  );
}

const inert: Bus = {
  protocol: 1,
  version: VERSION,
  emit: dropped,
  on: (channel: string, listener: unknown) => (assertListener(listener), dropped(channel), noop),
  peek: dropped,
};

export function busFrom(getBus: () => NativeFederationBus | undefined): Bus {
  const current = () => (getBus() ?? inert) as Bus;
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
    // Still undefined when the bus has no tap, so callers can feature-detect with `bus.tap?.()`.
    get tap() {
      const resolved = current();
      return resolved.tap && ((name: string, listener: TapListener) => resolved.tap!(name, listener));
    },
  } satisfies Bus);
}
