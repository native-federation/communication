// Type-checked against the built d.ts, imported by package name like an app would.
import { bus, createBus, type Bus } from '@softarc/native-federation-communication';
import type { ChannelValue } from '@softarc/native-federation-communication/domain';

declare module '@softarc/native-federation-communication' {
  interface Channels {
    'cart:count': number;
  }
}

export const page: Bus = bus;
bus.emit('cart:count', 1);
// @ts-expect-error a declared channel rejects a wrong payload
bus.emit('cart:count', 'one');
bus.on('cart:count', value => value.toFixed());
export const count: number | undefined = createBus().peek('cart:count');

export const viaDomain: ChannelValue<'cart:count'> = 1;
// @ts-expect-error ChannelValue from ./domain sees the augmentation made on the main entry
export const wrongViaDomain: ChannelValue<'cart:count'> = 'one';

// @ts-expect-error an undeclared (or misspelt) channel is unknown
export const typo: number | undefined = bus.peek('cart:cuont');

// The global is untyped, and a typed bus fits in it.
globalThis.__NF_BUS__?.emit('cart:count', 'anything');
export const slot: NativeFederationBus = createBus();
