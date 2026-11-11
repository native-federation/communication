// Augmented by consumers via declaration merging.
export interface Channels {}
export type ChannelName = keyof Channels | (string & {});
export type ChannelValue<K> = K extends keyof Channels ? Channels[K] : unknown;
export type Listener<T> = (value: T) => void;
export type Unsubscribe = () => void;
// retain: false = deliver to current listeners only and clear the channel's retained value.
export type EmitOptions = { retain?: boolean };
export type OnOptions = { signal?: AbortSignal };

// Every copy on a page shares this shape through globalThis.__NF_BUS__: members and options are
// append-only, and a breaking change needs a new global key.
export type Bus = {
  readonly protocol: number;
  readonly version: string;
  emit<K extends ChannelName>(channel: K, value: ChannelValue<K>, options?: EmitOptions): void;
  on<K extends ChannelName>(
    channel: K,
    listener: Listener<ChannelValue<K>>,
    options?: OnOptions
  ): Unsubscribe;
  peek<K extends ChannelName>(channel: K): ChannelValue<K> | undefined;
};

declare global {
  var __NF_BUS__: Bus | undefined;
}
