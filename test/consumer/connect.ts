// connect, tap and the ./transport/cross-tab subpath, imported by package name like an app would.
import {
  bus,
  connect,
  createBus,
  type Connection,
  type ConnectOptions,
  type Envelope,
  type Tap,
  type TapObserver,
  type Transport,
} from '@softarc/native-federation-communication';
import type * as domain from '@softarc/native-federation-communication/domain';
import { broadcastTransport } from '@softarc/native-federation-communication/transport/cross-tab';

export const tabs: Connection | undefined = connect(broadcastTransport(), ['cart:count']);
connect(broadcastTransport('my-app'), ['cart:count'], { bus });
connect(broadcastTransport(), ['cart:count'], { bus: createBus() });
connect(broadcastTransport(), ['cart:count'], { bus: globalThis.__NF_BUS__! });
tabs?.replay();
tabs?.close();
// @ts-expect-error connect returns undefined when refused
connect(broadcastTransport(), ['cart:count']).close();
// @ts-expect-error channels is a list, not a single name
connect(broadcastTransport(), 'cart:count');
// @ts-expect-error a wire is a string
broadcastTransport(1);

// A transport of the app's own, typed through ./domain.
export const custom: domain.Transport = {
  name: 'custom',
  send: (envelope: domain.Envelope) => console.log(envelope.channel, envelope.retain),
  listen: receive => {
    receive({ channel: 'cart:count', value: 1, retain: true });
    return () => {};
  },
};
connect(custom, ['cart:count']);
// @ts-expect-error a transport needs a name
export const nameless: Transport = { send: () => {}, listen: () => () => {} };
// @ts-expect-error an envelope carries retain
export const envelope: Envelope = { channel: 'a', value: 1 };

// tap is optional, on the typed bus and on the untyped global alike.
const observer: TapObserver = ({ channel, value, retain }) => console.log(channel, value, retain);
// @ts-expect-error an observer takes one envelope, not positional arguments
export const positional: TapObserver = (channel: string, value: unknown) =>
  console.log(channel, value);
export const tap: Tap | undefined = bus.tap?.('logger', observer);
globalThis.__NF_BUS__?.tap?.('logger', observer)?.close();
// @ts-expect-error a bus installed by an older copy has no tap, so it must be feature-checked
bus.tap('logger', observer);
tap?.emit('cart:count', 1, { retain: false });
tap?.replay();

// The types from both entries are the same types.
export const options: domain.ConnectOptions = {} satisfies ConnectOptions;
export const viaDomain: domain.Connection | undefined = tabs;
export const domainTap: domain.Tap | undefined = tap;
export const domainObserver: domain.TapObserver = observer;
