import { Observable } from 'rxjs';
import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @returns {Observable<import('@softarc/native-federation-communication').ChannelValue<K>>}
 */
export const fromChannel = channel =>
  new Observable(subscriber => bus.on(channel, value => subscriber.next(value)));
