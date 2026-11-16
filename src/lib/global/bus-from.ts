import type { Bus, TapListener } from '../domain/bus/bus.contract.js';
import { assertChannel, assertGetter, assertListener, noop } from '../bus/arguments.js';
import { VERSION } from '../bus/create-bus.js';

let warned = false;

// Remotes must not install a bus themselves (each would get its own), so this points at the host.
function dropped(method: string, channel: unknown): undefined {
  assertChannel(channel);
  if (warned) return;
  warned = true;
  console.warn(
    `[native-federation-communication] No bus is available here, so ${method}('${channel}') and ` +
      'every later call until one is installed are dropped; listeners added now are lost. The host ' +
      "installs a bus with '@softarc/native-federation-communication/install'."
  );
}

const inert: Bus = {
  protocol: 1,
  version: VERSION,
  emit: (channel: string) => dropped('emit', channel),
  on: (channel: string, listener: unknown) => {
    assertListener(listener);
    dropped('on', channel);
    return noop;
  },
  peek: (channel: string) => dropped('peek', channel),
};

export function busFrom(getBus: () => NativeFederationBus | undefined): Bus {
  assertGetter(getBus);
  const current = (): Bus => {
    const resolved = getBus() ?? inert;
    if (resolved === facade) {
      throw new TypeError(
        "[native-federation-communication] This busFrom bus resolves to itself, e.g. the package's " +
          '`bus` was given to installNFBus. Install a bus from createBus() instead.'
      );
    }
    return resolved as Bus;
  };
  const facade: Bus = Object.freeze({
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
      return (
        resolved.tap && ((name: string, listener: TapListener) => resolved.tap!(name, listener))
      );
    },
  } satisfies Bus);
  return facade;
}
