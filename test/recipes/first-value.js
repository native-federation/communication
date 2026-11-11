import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('@softarc/native-federation-communication').ChannelValue<K>>}
 */
export function firstValue(channel, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const done = new AbortController();
    const stop = signal ? AbortSignal.any([signal, done.signal]) : done.signal;
    if (stop.aborted) return reject(signal?.reason);
    stop.addEventListener('abort', () => reject(signal?.reason));
    bus.on(channel, value => (resolve(value), done.abort()), { signal: stop });
  });
}
