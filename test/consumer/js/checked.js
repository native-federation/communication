// @ts-check
// Plain JS with checkJs and the channels.d.ts next to it, as docs/typing.md "In JavaScript" describes.
import { bus } from '@softarc/native-federation-communication';

bus.emit('cart:count', 1);
// @ts-expect-error a declared channel rejects a wrong payload
bus.emit('cart:count', 'one');
bus.on('cart:count', value => value.toFixed());

/** @type {import('@softarc/native-federation-communication').ChannelValue<'cart:count'>} */
export const viaJsDoc = 1;

/** @type {import('@softarc/native-federation-communication').ChannelValue<'cart:count'>} */
// @ts-expect-error a JSDoc ChannelValue sees the augmentation
export const wrongViaJsDoc = 'one';
