import type { ChannelName, Tap } from '../domain/bus/bus.contract.js';
import type { Connection, ConnectOptions, Transport } from '../domain/connect/connect.contract.js';
import { assertChannel, noop } from '../bus/arguments.js';
import { getGlobalBus } from '../global/global-bus.js';

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
    replay: tap.replay,
    close: () => {
      tap.close();
      const stop = unlisten;
      unlisten = noop;
      stop();
    },
  };
}

export function connect(
  transport: Transport,
  channels: readonly ChannelName[],
  options?: ConnectOptions
): Connection | undefined {
  channels.forEach(assertChannel);
  const listed = new Set<string>(channels);
  const bus = options?.bus ?? getGlobalBus();
  if (!bus.tap) {
    console.warn(
      '[native-federation-communication] This bus cannot connect transports: an older copy installed ' +
        'it, or this is not a single-user realm (a browser page or React Native).'
    );
    return undefined;
  }
  const tap = bus.tap(transport.name, envelope => {
    if (listed.has(envelope.channel)) transport.send(envelope);
  });
  return tap && link(transport, tap, listed);
}
