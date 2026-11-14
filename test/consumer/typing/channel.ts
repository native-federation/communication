import {
  bus,
  type ChannelName,
  type ChannelValue,
  type EmitOptions,
  type OnOptions,
} from '@softarc/native-federation-communication';

export const channel = <K extends ChannelName>(name: K) => ({
  emit: (value: ChannelValue<K>, options?: EmitOptions) => bus.emit(name, value, options),
  on: (listener: (value: ChannelValue<K>) => void, options?: OnOptions) =>
    bus.on(name, listener, options),
  peek: () => bus.peek(name),
});
