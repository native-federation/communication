[< back](./../README.md)

# Migrating from the registry

The orchestrator's event registry (`init-registry.mjs`, `window.__NF_REGISTRY__`, the `/registry`
subpath) is deprecated in favour of this package. It keeps working as before, so you can move at your
own pace.

The registry had two concepts, _resources_ (`register` / `onReady`) and _event streams_ (`emit` / `on`).
This bus has one: a channel that retains its value. A resource and a stream that used the same name in
the registry were separate; on the bus they are the same channel.

## Mapping

| Registry                                                        | Bus                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `<script src="…/init-registry.mjs">`                            | `<script src="https://unpkg.com/@softarc/native-federation-communication@4/init-bus.js">`                                                   |
| `window.__NF_REGISTRY__`                                        | `window.__NF_BUS__`, or `import { bus } from '@softarc/native-federation-communication'`                                                    |
| `register(name, value)`                                         | `emit(name, value)`                                                                                                                         |
| `register(name, async () => value)`                             | `emit(name, await provider())`: a function is now emitted as a value, not called                                                            |
| `onReady(name, callback)`                                       | `on(name, callback)` for a channel emitted once, or the [`firstValue`](./recipes.md#wait-for-a-first-value-firstvalue) recipe for a promise |
| `emit(name, data)`                                              | `emit(name, data)`                                                                                                                          |
| `on(name, ({ data }) => …)`                                     | `on(name, data => …)`: listeners receive the value itself, without an envelope                                                              |
| `on(name, callback, { replay: 0 })`                             | the producer emits with `{ retain: false }`                                                                                                 |
| `on(name, callback, { replay: n })` with `n > 1`                | not supported: one retained value per channel (keep a list in the value if you need one)                                                    |
| `update(name, current => next)`                                 | `emit(name, next(bus.peek(name)))`                                                                                                          |
| `clear(name)` / `clear()`                                       | not supported; in tests, use a fresh `createBus()`                                                                                          |
| `data-max-streams`, `data-max-events`, `data-remove-percentage` | not needed: each channel retains one value                                                                                                  |
| `{ data, timestamp }`                                           | put a timestamp in the value if a consumer needs one                                                                                        |

`orch.init-ready` keeps its name. The orchestrator emits it on both the registry and the bus, whichever
is on the page; see [Getting Started](./getting-started.md#waiting-for-the-orchestrator-orchinit-ready).

## Behaviour changes

- **No envelope.** Listeners get the value, not `{ data, timestamp }`.
- **No clone.** The registry cloned values for replay and `update`, which silently dropped functions.
  The bus hands everyone the producer's reference, so emit a new object for every change and don't
  mutate what you receive.
- **Synchronous replay.** The registry replayed stream history in a microtask. The bus calls the
  listener with the retained value before `on` returns, like `onReady` did for resources.
- **Functions and `undefined` are values.** `register` called a function and stored its result, and
  `register(name, undefined)` never satisfied `onReady`. The bus emits both as ordinary values.
- **The producer decides about replay.** Instead of each consumer choosing a `replay` count, the
  producer emits commands with `{ retain: false }`.
- **Isolated listeners.** A throwing listener no longer stops the other listeners or the producer; the
  error goes to `reportError`.

## Pages with both

During a migration a page can load `init-registry.mjs` and `init-bus.js` side by side. They are separate
buses: a value emitted on one is never delivered on the other. So move each channel's producer and its
consumers together, or let the producer emit on both until every consumer has moved:

```ts
const cart = { count: 3 };
window.__NF_REGISTRY__?.emit('cart.changed', cart);
bus.emit('cart.changed', cart);
```
