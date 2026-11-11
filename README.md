# Native federation communication

A tiny, page-wide channel bus that lets independently deployed micro frontends talk to each other.

[![Verify library](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml/badge.svg)](https://github.com/native-federation/communication/actions/workflows/verify-code.yaml)
![Coverage total](https://raw.githubusercontent.com/native-federation/communication/badges/badges/coverage-total.svg)

## Why

Plain `window` events are the usual way micro frontends talk, and they leave three gaps that every team
runs into sooner or later:

- 🕰️ **Late listeners** - a remote that loads after an event was dispatched never hears it. A channel
  keeps its retained value, and a new listener receives it the moment it subscribes.
- 🏷️ **Typing** - an event name is just a string. Channels are typed through declaration merging, and a
  channel nobody declared is typed `unknown`.
- 👯 **Multiple copies** - with independent deploys, several copies (and versions) of a library end up on
  one page. Every copy of this package finds and uses the same bus, so correctness never depends on how
  you configure sharing.

Everything else is left out on purpose: no history beyond one retained value, no reducers, no channel
lifecycle, no routing. The whole API is `emit`, `on` and `peek`.

> **Keep communication rare.** Micro frontends that talk a lot are usually cut along the wrong line.
> Prefer the URL for navigation state, and attributes or properties for parent-to-child data. Reach for a
> channel when neither fits.

## Quick Start

```bash
npm install @softarc/native-federation-communication
```

```ts
import { bus } from '@softarc/native-federation-communication';

// checkout remote: publish state
bus.emit('cart:changed', { count: 3 });

// header remote, loaded at any time: receives { count: 3 } right away, then every later value
const off = bus.on('cart:changed', ({ count }) => (badge.textContent = String(count)));

// a command: delivered to the listeners subscribed right now, never replayed to later ones
bus.emit('ui:toast', { text: 'Added to cart' }, { retain: false });
```

No build step? Load the script before anything else on the page and use the global, which has the same
methods:

```html
<script src="https://unpkg.com/@softarc/native-federation-communication@4/init-bus.js"></script>
<script>
  __NF_BUS__.on('cart:changed', ({ count }) => console.log(count));
</script>
```

> 📖 **See [Getting Started](https://github.com/native-federation/communication/blob/main/docs/getting-started.md)**, including how to receive the orchestrator's `orch.init-ready`.

## Documentation

| Guide                                                                                                                          | Description                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [🚀 Getting Started](https://github.com/native-federation/communication/blob/main/docs/getting-started.md)                     | Install, first channels, waiting for the orchestrator            |
| [📖 API](https://github.com/native-federation/communication/blob/main/docs/api.md)                                             | Glossary, `emit` / `on` / `peek`, delivery rules and pitfalls    |
| [🏷️ Typing](https://github.com/native-federation/communication/blob/main/docs/typing.md)                                       | Typed channels across independently deployed apps                |
| [🍳 Recipes](https://github.com/native-federation/communication/blob/main/docs/recipes.md)                                     | Angular, React, RxJS, custom elements, waiting for a first value |
| [👯 Multiple copies](https://github.com/native-federation/communication/blob/main/docs/multiple-copies.md)                     | How copies share one bus; iframes, workers and SSR               |
| [🔀 Migrating from the registry](https://github.com/native-federation/communication/blob/main/docs/migrating-from-registry.md) | Moving from the orchestrator's `__NF_REGISTRY__`                 |

## License

MIT, see [LICENSE.md](./LICENSE.md).
