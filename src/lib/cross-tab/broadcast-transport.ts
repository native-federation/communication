import type { Envelope, Transport } from '../domain/connect/connect.contract.js';
import { noop } from '../bus/arguments.js';

export function broadcastTransport(wire = 'native-federation-communication'): Transport {
  let port: BroadcastChannel | undefined;
  return Object.freeze({
    name: `broadcast:${wire}`,
    send: (envelope: Envelope) => port?.postMessage(envelope),
    // Opened here, not up front, so a refused connect opens nothing. One channel per instance:
    // send has no way to tell listens apart, so a second one would post on the first's channel.
    listen: (receive: (envelope: Envelope) => void) => {
      if (port || typeof BroadcastChannel !== 'function') return noop;
      const opened = new BroadcastChannel(wire);
      opened.onmessage = (event: MessageEvent<Envelope>) => receive(event.data);
      port = opened;
      return () => {
        opened.close();
        port = undefined;
      };
    },
  });
}
