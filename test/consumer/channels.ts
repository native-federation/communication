// Type-checked against the built d.ts, imported by package name like an app would.
import {
  bus,
  createBus,
  type Bus,
  type ChannelValue as MainChannelValue,
} from '@softarc/native-federation-communication';
import type { ChannelValue } from '@softarc/native-federation-communication/domain';

declare module '@softarc/native-federation-communication' {
  interface Channels {
    'cart:count': number;
    'ui:theme': 'light' | 'dark';
  }
}

export const page: Bus = bus;
bus.emit('cart:count', 1);
// @ts-expect-error a declared channel rejects a wrong payload
bus.emit('cart:count', 'one');
bus.on('cart:count', value => value.toFixed());
export const count: number | undefined = createBus().peek('cart:count');
// @ts-expect-error peek includes undefined: nothing may have been retained yet
export const always: number = bus.peek('cart:count');

export const viaMain: MainChannelValue<'cart:count'> = 1;
// @ts-expect-error ChannelValue from the main entry sees the augmentation
export const wrongViaMain: MainChannelValue<'cart:count'> = 'one';
export const viaDomain: ChannelValue<'cart:count'> = 1;
// @ts-expect-error ChannelValue from ./domain sees the augmentation made on the main entry
export const wrongViaDomain: ChannelValue<'cart:count'> = 'one';

// @ts-expect-error an undeclared (or misspelt) channel is unknown
export const typo: number | undefined = bus.peek('cart:cuont');
// @ts-expect-error a listener on an undeclared channel gets unknown, not any
bus.on('cart:cuont', value => value.toFixed());

// A name widened to string is an undeclared channel: any value goes in, unknown comes out.
declare const someName: string;
bus.emit(someName, 'anything');
// @ts-expect-error a widened name peeks unknown
export const widened: number | undefined = bus.peek(someName);

// Known gap (docs/typing.md): a union of names accepts the union of their values.
declare const either: 'cart:count' | 'ui:theme';
bus.emit(either, 1);

// @ts-expect-error retain is a boolean
bus.emit('cart:count', 1, { retain: 'no' });
// @ts-expect-error a misspelt option is rejected
bus.emit('cart:count', 1, { retian: false });
// @ts-expect-error a misspelt option is rejected
bus.on('cart:count', () => {}, { repaly: false });

// The global is untyped, and a typed bus fits in it, but not the other way round.
globalThis.__NF_BUS__?.emit('cart:count', 'anything');
export const slot: NativeFederationBus = createBus();
// @ts-expect-error the untyped global is not a typed Bus
export const typed: Bus | undefined = globalThis.__NF_BUS__;
