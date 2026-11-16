import type { Envelope } from '../domain/bus/bus.contract.js';
import type { Transport } from '../domain/connect/connect.contract.js';

export function broadcastTransport(wire = 'native-federation-communication'): Transport {
  let port: BroadcastChannel | undefined;
  let listening = false;
  return Object.freeze({
    name: `broadcast:${wire}`,
    send: (envelope: Envelope) => port?.postMessage(envelope),
    // Opened here, not up front, so a refused connect opens nothing.
    listen: (receive: (envelope: Envelope) => void) => {
      if (listening) {
        throw new Error(
          `[native-federation-communication] broadcastTransport('${wire}') is already listening; use one instance per connection.`
        );
      }
      listening = true;
      port = open(wire, receive);
      return () => {
        port?.close();
        port = undefined;
        listening = false;
      };
    },
  });
}

function open(wire: string, receive: (envelope: Envelope) => void): BroadcastChannel | undefined {
  if (typeof BroadcastChannel !== 'function') return undefined;
  const opened = new BroadcastChannel(wire);
  opened.onmessage = (event: MessageEvent<Envelope>) => receive(event.data);
  return opened;
}
