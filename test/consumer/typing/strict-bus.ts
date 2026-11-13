import {
  bus,
  type Channels,
  type EmitOptions,
  type OnOptions,
  type Unsubscribe,
} from '@softarc/native-federation-communication';

// Accepts declared channels only, so a misspelt name is a compile error.
export type StrictBus = {
  emit<K extends keyof Channels>(channel: K, value: Channels[K], options?: EmitOptions): void;
  on<K extends keyof Channels>(
    channel: K,
    listener: (value: Channels[K]) => void,
    options?: OnOptions
  ): Unsubscribe;
  peek<K extends keyof Channels>(channel: K): Channels[K] | undefined;
};

export const strictBus = bus as StrictBus;
