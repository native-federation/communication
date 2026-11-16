import type { ChannelName } from '../domain/bus/bus.contract.js';
import { assertChannel, noop } from '../bus/arguments.js';
import { getGlobalBus, isPage } from '../global/global-bus.js';

export type CrossTabOptions = { bus?: NativeFederationBus };
type Message = { channel: string; value: unknown; retain: boolean };

const WIRE_NAME = 'native-federation-communication:1';
const CLAIMS: unique symbol = Symbol.for(`${WIRE_NAME}:claims`);
const root = globalThis as typeof globalThis & { [CLAIMS]?: WeakMap<object, Set<string>> };

// Shared by every copy on the page: two bridges for one channel in one tab would echo each other forever.
function claim(bus: object, channels: readonly string[]) {
  const registry = (root[CLAIMS] ??= new WeakMap());
  let claimed = registry.get(bus);
  if (!claimed) registry.set(bus, (claimed = new Set()));
  const owned = new Set(channels.filter(channel => !claimed.has(channel)));
  owned.forEach(channel => claimed.add(channel));
  const release = (): void => {
    owned.forEach(channel => claimed.delete(channel));
    owned.clear();
  };
  return { owned, release };
}

// A server is not a tab, and Node's BroadcastChannel crosses worker_threads.
function pageBusUnlessGiven(options?: CrossTabOptions): NativeFederationBus | undefined {
  return options?.bus ?? (isPage() ? getGlobalBus() : undefined);
}

export function shareAcrossTabs(
  channels: readonly ChannelName[],
  options?: CrossTabOptions
): () => void {
  channels.forEach(assertChannel);
  if (typeof BroadcastChannel !== 'function') return noop;
  const bus = pageBusUnlessGiven(options);
  if (!bus) return noop;
  const { owned, release } = claim(bus, channels);
  if (owned.size === 0) return noop;

  const port = new BroadcastChannel(WIRE_NAME);
  let applying: string | undefined;
  const unsubscribes = [...owned].map(channel =>
    bus.on(
      channel,
      value => {
        // Delivery is synchronous, so the first value seen while applying is the applied one.
        if (applying === channel) {
          applying = undefined;
          return;
        }
        // peek can't tell a retained undefined from none, so undefined always travels unretained.
        const retain = value !== undefined && Object.is(bus.peek(channel), value);
        port.postMessage({ channel, value, retain } satisfies Message);
      },
      { replay: false }
    )
  );
  port.onmessage = ({ data }: MessageEvent<Message | null>) => {
    if (!data || !owned.has(data.channel)) return;
    applying = data.channel;
    bus.emit(data.channel, data.value, { retain: data.retain });
    applying = undefined;
  };

  return () => {
    unsubscribes.forEach(off => off());
    port.close();
    release();
  };
}
