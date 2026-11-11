import { useCallback, useSyncExternalStore } from 'react';
import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @returns {import('@softarc/native-federation-communication').ChannelValue<K> | undefined}
 */
export function useChannel(channel) {
  const subscribe = useCallback(onChange => bus.on(channel, onChange), [channel]);
  return useSyncExternalStore(
    subscribe,
    () => bus.peek(channel),
    () => undefined
  );
}
