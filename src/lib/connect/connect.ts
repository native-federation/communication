import type { ChannelName, Tap } from '../domain/bus/bus.contract.js';
import type {
  Connection,
  ConnectTransportOptions,
  Transport,
} from '../domain/connect/connect.contract.js';
import { assertChannel, assertTransportName, noop } from '../bus/arguments.js';
import { bus as globalBus } from '../global/global-bus.js';
import { getGlobalBus } from '../global/slot.js';

function link(transport: Transport, tap: Tap, listed: Set<string>): Connection {
  let unlisten: () => void;
  try {
    // Inbound data comes from outside this realm, so anything unlisted is ignored.
    unlisten = transport.listen(envelope => {
      if (listed.has(envelope?.channel))
        tap.emit(envelope.channel, envelope.value, { retain: envelope.retain });
    });
  } catch (error) {
    tap.close();
    throw error;
  }
  return {
    replayRetained: tap.replay,
    close: () => {
      tap.close();
      const stop = unlisten;
      unlisten = noop;
      stop();
    },
  };
}

// An explicit `bus: undefined`, e.g. an iframe's empty slot, must not fall back to the page bus.
const explicit = (options?: ConnectTransportOptions) => !!options && 'bus' in options;

function refusal(options?: ConnectTransportOptions): string {
  if (!explicit(options)) {
    return getGlobalBus()
      ? 'the installed bus has no tap (an older copy installed it)'
      : 'no bus is installed';
  }
  return options!.bus ? 'options.bus has no tap' : 'options.bus is undefined';
}

const warn = (name: string, cause: string): undefined =>
  void console.warn(
    `[native-federation-communication] Transport '${name}' is not connected: ${cause}.`
  );

export function connectTransport(
  transport: Transport,
  channels: readonly ChannelName[],
  options?: ConnectTransportOptions
): Connection | undefined {
  assertTransportName(transport.name);
  channels.forEach(assertChannel);
  const listed = new Set<string>(channels);
  const bus = explicit(options) ? options!.bus : globalBus;
  if (!bus?.tap) return warn(transport.name, refusal(options));
  const tap = bus.tap(transport.name, envelope => {
    if (listed.has(envelope.channel)) transport.send(envelope);
  });
  if (!tap)
    return warn(transport.name, 'the name is already taken on this bus by a tap or transport');
  return link(transport, tap, listed);
}
