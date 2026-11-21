import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @param {{ signal?: AbortSignal, replay?: boolean }} [options]
 * @returns {AsyncIterableIterator<import('@softarc/native-federation-communication').ChannelValue<K>>}
 */
export function values(channel, { signal, replay } = {}) {
  const queue = [];
  let wake = () => {};
  const done = new AbortController();
  const stop = signal ? AbortSignal.any([signal, done.signal]) : done.signal;
  const end = () => (done.abort(), { done: true, value: undefined });
  stop.addEventListener('abort', () => wake());
  bus.on(channel, value => (queue.push(value), wake()), { signal: stop, replay });
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      while (!queue.length && !stop.aborted) await new Promise(resolve => (wake = resolve));
      return stop.aborted ? end() : { done: false, value: queue.shift() };
    },
    async return() {
      return end();
    },
  };
}
