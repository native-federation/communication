import type { ChannelName, Tap } from '../domain/bus/bus.contract.js';
import type { Connection, ConnectTransportOptions, Transport } from '../domain/connect/connect.contract.js';
import { assertChannel, noop } from '../bus/arguments.js';
import { bus as globalBus } from '../global/global-bus.js';

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
const chosenBus = (options?: ConnectTransportOptions) =>
  options && 'bus' in options ? options.bus : globalBus;

export function connectTransport(
  transport: Transport,
  channels: readonly ChannelName[],
  options?: ConnectTransportOptions
): Connection | undefined {
  channels.forEach(assertChannel);
  const listed = new Set<string>(channels);
  const bus = chosenBus(options);
  if (!bus?.tap) {
    console.warn(
      '[native-federation-communication] This bus cannot connect transports: no bus is installed, ' +
        'or an older copy installed it.'
    );
    return undefined;
  }
  const tap = bus.tap(transport.name, envelope => {
    if (listed.has(envelope.channel)) transport.send(envelope);
  });
  return tap && link(transport, tap, listed);
}
