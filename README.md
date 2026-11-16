# Native federation communication

A tiny, page-wide channel bus for micro frontends that are built and deployed apart. A listener that
subscribes late still gets the last value, every copy of the package on the page shares one bus, and
TypeScript is optional.

[![Verify library](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml/badge.svg)](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml)
![Coverage total](https://raw.githubusercontent.com/native-federation/communication/badges/badges/coverage-total.svg)

## Quick start

```bash
npm install @softarc/native-federation-communication
```

There are two roles:

1. **The host installs the bus, once.** Make this the first import of the module that
   `initFederation` loads, often `bootstrap.ts`. `main.ts` is too early: shared packages resolve only
   after `initFederation`. Without a build step, load the
   [`install.js` script tag](https://github.com/native-federation/communication/blob/main/docs/getting-started.md#with-a-script-tag)
   instead.

   ```js
   import '@softarc/native-federation-communication/install';
   ```

2. **The host and every remote import `bus`** and talk over named channels:

   ```js
   import { bus } from '@softarc/native-federation-communication';

   // checkout: publish state on the 'cart:changed' channel
   bus.emit('cart:changed', { count: 3 });

   // header, loaded before or after: called with { count: 3 } at once, then with every later value
   const off = bus.on('cart:changed', ({ count }) => (badge.textContent = String(count)));
   off(); // when the header is torn down

   // a command: only the listeners subscribed right now get it, and nothing is kept for later ones
   bus.emit('ui:toast', { text: 'Added to cart' }, { retain: false });
   ```

A remote never installs a bus. If the host hasn't installed one, `bus` drops every call and logs a
[warning](https://github.com/native-federation/communication/blob/main/docs/api.md#without-an-installed-bus).

Use the bus only for what nothing else carries: navigation state belongs in the URL, data from a
parent to a child component in attributes.

## Documentation

| Guide                                                                                                                       | Read it to                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](https://github.com/native-federation/communication/blob/main/docs/getting-started.md)                     | Install the bus, then publish state and send commands         |
| [API](https://github.com/native-federation/communication/blob/main/docs/api.md)                                             | Look up every export, option, error and warning               |
| [Typing](https://github.com/native-federation/communication/blob/main/docs/typing.md)                                       | Check channel values in TypeScript and JavaScript             |
| [Recipes](https://github.com/native-federation/communication/blob/main/docs/recipes.md)                                     | Use it from Angular, React, RxJS, custom elements, SSR, tests |
| [Multiple copies](https://github.com/native-federation/communication/blob/main/docs/multiple-copies.md)                     | Mix versions on one page, run outside a browser, upgrade      |
| [Cross-tab](https://github.com/native-federation/communication/blob/main/docs/cross-tab.md)                                 | Share channels between tabs of the same origin                |
| [Migrating from the registry](https://github.com/native-federation/communication/blob/main/docs/migrating-from-registry.md) | Replace the orchestrator's `__NF_REGISTRY__` with the bus     |

## License

MIT, see [LICENSE.md](./LICENSE.md).
