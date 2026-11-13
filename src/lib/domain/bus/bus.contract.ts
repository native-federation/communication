// Augmented by consumers via declaration merging.
export interface Channels {}
// `string & {}` accepts any name without collapsing the union, so editors still complete declared names.
export type ChannelName = keyof Channels | (string & {});
export type ChannelValue<K> = K extends keyof Channels ? Channels[K] : unknown;
export type Listener<T> = (value: T) => void;
export type Unsubscribe = () => void;
// retain: false = deliver to current listeners only and clear the channel's retained value.
export type EmitOptions = { retain?: boolean };
// replay: false = skip the retained value and receive live values only.
export type OnOptions = { signal?: AbortSignal; replay?: boolean };

// The typed view of a bus; typed access goes through `bus` or `createBus()`.
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
  // Every copy's declaration merges into this one interface, so a member never changes type and a
  // later one is added optional. An option or semantic change that an older bus would ignore needs a
  // protocol bump that callers check before relying on it.
  interface NativeFederationBus {
    readonly protocol: number;
    readonly version: string;
    emit(channel: string, value: unknown, options?: EmitOptions): void;
    on(channel: string, listener: (value: unknown) => void, options?: OnOptions): () => void;
    peek(channel: string): unknown;
  }
  var __NF_BUS__: NativeFederationBus | undefined;
}
