import type { Bus, Envelope, Unsubscribe } from '../bus/bus.contract.js';

export type Transport = {
  // Unique per bus: a second connect with the same name is refused.
  readonly name: string;
  send(envelope: Envelope): void;
  listen(receive: (envelope: Envelope) => void): Unsubscribe;
};
export type Connection = { replay(): void; close(): void };
export type ConnectOptions = { bus?: Bus | NativeFederationBus };
