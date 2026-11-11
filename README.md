# Native federation communication

A tiny, page-wide channel bus for micro frontends that are built and deployed apart. A late listener
still gets the last value, every copy of the package on the page shares one bus, and TypeScript is
optional.

[![Verify library](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml/badge.svg)](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml)
![Coverage total](https://raw.githubusercontent.com/native-federation/communication/badges/badges/coverage-total.svg)

## Quick start

```bash
npm install @softarc/native-federation-communication
```

```js
import { bus } from '@softarc/native-federation-communication';

// checkout: publish state
bus.emit('cart:changed', { count: 3 });

// header, loaded at any time: gets { count: 3 } at once, then every later value
const off = bus.on('cart:changed', ({ count }) => (badge.textContent = String(count)));

// a command: only the listeners subscribed right now get it
bus.emit('ui:toast', { text: 'Added to cart' }, { retain: false });
```

No build step? Use the [script tag](https://github.com/native-federation/communication/blob/main/docs/getting-started.md#with-a-script-tag).

Keep communication rare: navigation state belongs in the URL, parent-to-child data in attributes.

## Documentation

| Guide                                                                                                                       | What it covers                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [Getting started](https://github.com/native-federation/communication/blob/main/docs/getting-started.md)                     | Install, the script tag, state and commands       |
| [API](https://github.com/native-federation/communication/blob/main/docs/api.md)                                             | `emit`, `on`, `peek`, delivery rules and pitfalls |
| [Typing](https://github.com/native-federation/communication/blob/main/docs/typing.md)                                       | Checked channels in TypeScript and JavaScript     |
| [Recipes](https://github.com/native-federation/communication/blob/main/docs/recipes.md)                                     | Angular, React, RxJS, custom elements, SSR, tests |
| [Multiple copies](https://github.com/native-federation/communication/blob/main/docs/multiple-copies.md)                     | One bus for all copies, the protocol, Node        |
| [Migrating from the registry](https://github.com/native-federation/communication/blob/main/docs/migrating-from-registry.md) | Moving from the orchestrator's `__NF_REGISTRY__`  |

## License

MIT, see [LICENSE.md](./LICENSE.md).
