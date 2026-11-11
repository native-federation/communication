[< back](./../README.md)

# Migrating from the registry

The orchestrator's event registry (`init-registry.mjs`, `window.__NF_REGISTRY__`, the `/registry`
subpath) is deprecated in favour of this package. It keeps working, so you can move at your own pace.

The registry had resources (`register` / `onReady`) and streams (`emit` / `on`). The bus has channels
that keep their last value; a resource and a stream with the same name become one channel.

## Mapping

| Registry                                                        | Bus                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `<script src="…/init-registry.mjs">`                            | `<script src="…/init-bus.js">`, see [Getting started](./getting-started.md#with-a-script-tag)      |
| `window.__NF_REGISTRY__ ??= createRegistry(options)()` in code  | delete it: the first `bus` call installs the bus                                                   |
| `declare global { interface Window { __NF_REGISTRY__ … } }`     | delete it: the package declares `__NF_BUS__`                                                       |
| `window.__NF_REGISTRY__`                                        | `import { bus } from '@softarc/native-federation-communication'`, or `globalThis.__NF_BUS__`       |
| `emit<Events['x']>('x', …)`, `on<Events['x']>(…)`               | `emit('x', …)`, `on('x', …)`, see [Typing](#typing)                                                |
| `await register(name, value)`                                   | `emit(name, value)`: it returns nothing, so drop the `await`                                       |
| `register(name, load)`                                          | `emit(name, await load())`: a function is now a value, not called                                  |
| `register(name, () => fn)`, to publish `fn`                     | `emit(name, fn)`, without the wrapper                                                              |
| `onReady(name, callback)`                                       | `on(name, callback)`, or [`firstValue`](./recipes.md#firstvalue) for a promise                     |
| `on(name, ({ data }) => …)`                                     | `on(name, value => …)`: listeners get the value itself                                             |
| `on(name, callback, { replay: 0 })`                             | `on(name, callback, { replay: false })` (`0` still works); producers emit with `{ retain: false }` |
| `on(name, callback, { replay: n })` with `n > 1`                | not supported: keep a list in the value                                                            |
| `update(name, current => next)`                                 | `emit(name, next(bus.peek(name)))`                                                                 |
| `clear(name)` / `clear()`                                       | not supported; tests get a fresh bus, see [Testing](./recipes.md#testing)                          |
| `data-max-streams`, `data-max-events`, `data-remove-percentage` | not needed: a channel keeps one value                                                              |
| `{ data, timestamp }`                                           | put a timestamp in the value if a consumer needs one                                               |

The bus needs no install line: the first copy used installs it. Only a script that emits on a bus
already on the page, such as the orchestrator's `orch.init-ready` announcement, needs `init-bus.js`
loaded before it.

`register(name, () => fn)` published `fn`, because `register` called functions. Ported literally,
`emit(name, () => fn)` publishes the wrapper, which only TypeScript on a declared channel catches.

## Typing

Move your `Events` interface into `Channels` (see [Typing](./typing.md)):

```ts
// before
export interface Events {
  'store:selected': { id: string };
}
window.__NF_REGISTRY__!.emit<Events['store:selected']>('store:selected', { id });

// after
declare module '@softarc/native-federation-communication' {
  interface Channels {
    'store:selected': { id: string };
  }
}
bus.emit('store:selected', { id });
```

Drop the type arguments. Where you used `Events['x']` as a type, use `ChannelValue<'x'>`.

## Behaviour changes

- **No copy.** The registry cloned values, which dropped functions. Listeners now get the producer's
  object, so don't mutate it.
- **Synchronous replay.** The retained value arrives before `on` returns.
- **Isolated listeners.** A throwing listener no longer stops the others or the producer.

## Pages with both

`init-registry.mjs` and `init-bus.js` can run side by side, as separate buses. Move a channel's producer
and consumers together, or emit on both meanwhile:

```js
const cart = { count: 3 };
globalThis.__NF_REGISTRY__?.emit('cart.changed', cart);
bus.emit('cart.changed', cart);
```
