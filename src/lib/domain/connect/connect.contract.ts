import type { Bus, Unsubscribe } from '../bus/bus.contract.js';

export type Envelope = { channel: string; value: unknown; retain: boolean };
export type Transport = {
  // Unique per bus: a second connect with the same name is refused.
  readonly name: string;
  send(envelope: Envelope): void;
  listen(receive: (envelope: Envelope) => void): Unsubscribe;
};
export type Connection = { replay(): void; close(): void };
export type ConnectOptions = { bus?: Bus | NativeFederationBus };
