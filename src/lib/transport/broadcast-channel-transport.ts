import type { Envelope } from '../domain/bus/bus.contract.js';
import type { Transport } from '../domain/connect/connect.contract.js';
import { noop } from '../bus/arguments.js';

export function broadcastChannelTransport(wire = 'native-federation-communication/1'): Transport {
  let port: BroadcastChannel | undefined;
  return {
    name: `broadcast:${wire}`,
    send: (envelope: Envelope) => port?.postMessage(envelope),
    // Opened here, not up front, so a refused connectTransport opens nothing.
    listen: (receive: (envelope: Envelope) => void) => {
      if (port) {
        throw new Error(
          `[native-federation-communication] broadcastChannelTransport('${wire}') is already listening; use one instance per connection.`
        );
      }
      if (typeof BroadcastChannel !== 'function') return noop;
      port = new BroadcastChannel(wire);
      port.onmessage = (event: MessageEvent<Envelope>) => receive(event.data);
      return () => {
        port?.close();
        port = undefined;
      };
    },
  };
}
