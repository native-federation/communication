// The typing recipes from docs/typing.md (typing/*.ts, published verbatim), used like an app would.
import './channels.js';
import { channel } from './typing/channel.js';
import { strictBus } from './typing/strict-bus.js';

strictBus.emit('cart:count', 1);
// @ts-expect-error a misspelt name is an error on the strict view
strictBus.emit('cart:cuont', 1);
// @ts-expect-error a misspelt name is an error on the strict view
strictBus.peek('ui:tehme');
// @ts-expect-error the strict view still checks the value
strictBus.emit('cart:count', 'one');
strictBus.on('cart:count', value => value.toFixed());

export const cartCount = channel('cart:count');
cartCount.emit(1);
// @ts-expect-error a handle takes its value type from Channels
cartCount.emit('one');
cartCount.on(value => value.toFixed());
export const latest: number | undefined = cartCount.peek();
