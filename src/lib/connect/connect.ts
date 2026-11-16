import type { ChannelName, Envelope, Tap } from '../domain/bus/bus.contract.js';
import type { Connection, ConnectOptions, Transport } from '../domain/connect/connect.contract.js';
import { assertChannel, noop } from '../bus/arguments.js';
import { getGlobalBus } from '../global/global-bus.js';

const idle: Connection = Object.freeze({ replay: noop, close: noop });
let warnedNoTap = false;

function assertTransport(transport: unknown): void {
  const candidate = transport as Partial<Record<keyof Transport, unknown>> | null | undefined;
  const valid =
    typeof candidate?.name === 'string' &&
    typeof candidate.send === 'function' &&
    typeof candidate.listen === 'function';
  if (!valid) {
    throw new TypeError(
      '[native-federation-communication] A transport must be an object with a string name and send and listen functions.'
    );
  }
}

function refuseNoTap(): Connection {
  if (!warnedNoTap) {
    warnedNoTap = true;
    console.warn(
      '[native-federation-communication] This bus cannot connect transports: an older copy installed ' +
        'it, or this is not a single-user realm (a browser page or React Native).'
    );
  }
  return idle;
}

function refuseTaken(name: string): Connection {
  console.warn(
    `[native-federation-communication] Transport "${name}" is already connected to this bus.`
  );
  return idle;
}

// Inbound data comes from outside this realm, so anything malformed or unlisted is ignored.
function receive(tap: Tap, listed: Set<string>, envelope: unknown): void {
  const { channel, value, retain } = (envelope ?? {}) as Partial<Envelope>;
  if (typeof channel === 'string' && listed.has(channel)) {
    tap.emit(channel, value, { retain });
  }
}

function listen(transport: Transport, tap: Tap, listed: Set<string>): () => void {
  try {
    return transport.listen(envelope => receive(tap, listed, envelope));
  } catch (error) {
    tap.close();
    throw error;
  }
}

function link(transport: Transport, tap: Tap, listed: Set<string>): Connection {
  const unlisten = listen(transport, tap, listed);
  let closed = false;
  return Object.freeze({
    replay: () => tap.replay(),
    close: () => {
      if (closed) return;
      closed = true;
      tap.close();
      unlisten();
    },
  });
}

export function connect(
  transport: Transport,
  channels: readonly ChannelName[],
  options?: ConnectOptions
): Connection {
  assertTransport(transport);
  channels.forEach(assertChannel);
  const listed = new Set<string>(channels);
  const bus = options?.bus ?? getGlobalBus();
  if (!bus.tap) return refuseNoTap();
  const tap = bus.tap(transport.name, envelope => {
    if (listed.has(envelope.channel)) transport.send(envelope);
  });
  return tap ? link(transport, tap, listed) : refuseTaken(transport.name);
}
