// connectTransport, tap, ./setup and the ./transport/broadcast-channel subpath, imported by package name like an
// app would.
import '@softarc/native-federation-communication/install';
import {
  bus,
  connectTransport,
  type Bus,
  type Connection,
  type ConnectTransportOptions,
  type Envelope,
  type Tap,
  type TapObserver,
  type Transport,
} from '@softarc/native-federation-communication';
import type * as domain from '@softarc/native-federation-communication/domain';
import {
  busFrom,
  createBus,
  getNFBus,
  installNFBus,
} from '@softarc/native-federation-communication/setup';
import { broadcastChannelTransport } from '@softarc/native-federation-communication/transport/broadcast-channel';

export const tabs: Connection | undefined = connectTransport(broadcastChannelTransport(), ['cart:count']);
connectTransport(broadcastChannelTransport('my-app'), ['cart:count'], { bus });
connectTransport(broadcastChannelTransport(), ['cart:count'], { bus: createBus() });
connectTransport(broadcastChannelTransport(), ['cart:count'], { bus: globalThis.__NF_BUS__! });

// A custom location goes through busFrom; getNFBus and installNFBus only use the global slot.
const frame = { __NF_BUS__: createBus() as NativeFederationBus | undefined };
export const framed: Bus = busFrom(() => frame.__NF_BUS__);
connectTransport(broadcastChannelTransport(), ['cart:count'], { bus: framed });
export const installed: Bus = installNFBus(createBus());
export const found: Bus | undefined = getNFBus();
connectTransport(broadcastChannelTransport(), ['cart:count'], { bus: found });
// @ts-expect-error there is no custom location any more
getNFBus({});
// @ts-expect-error there is no custom location any more
installNFBus(createBus(), {});
tabs?.replayRetained();
tabs?.close();
// @ts-expect-error connectTransport returns undefined when refused
connectTransport(broadcastChannelTransport(), ['cart:count']).close();
// @ts-expect-error channels is a list, not a single name
connectTransport(broadcastChannelTransport(), 'cart:count');
// @ts-expect-error a wire is a string
broadcastChannelTransport(1);

// A transport of the app's own, typed through ./domain.
export const custom: domain.Transport = {
  name: 'custom',
  send: (envelope: domain.Envelope) => console.log(envelope.channel, envelope.retain),
  listen: receive => {
    receive({ channel: 'cart:count', value: 1, retain: true });
    return () => {};
  },
};
connectTransport(custom, ['cart:count']);
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
export const viaDomainBus: domain.Bus = bus;
export const options: domain.ConnectTransportOptions = {} satisfies ConnectTransportOptions;
export const viaDomain: domain.Connection | undefined = tabs;
export const domainTap: domain.Tap | undefined = tap;
export const domainObserver: domain.TapObserver = observer;
