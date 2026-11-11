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
| `window.__NF_REGISTRY__ ??= createRegistry(options)()` in code  | delete it: the first `bus` call installs the bus                                                                                            |
| `declare global { interface Window { __NF_REGISTRY__ … } }`     | delete it: the package declares `__NF_BUS__` itself                                                                                         |
| `window.__NF_REGISTRY__`                                        | `window.__NF_BUS__`, or `import { bus } from '@softarc/native-federation-communication'`                                                    |
| `emit<Events['x']>('x', …)`, `on<Events['x']>(…)`               | `emit('x', …)`, `on('x', …)`: see [Typing](#typing)                                                                                         |
| `register(name, value)`                                         | `emit(name, value)`: `register` returned a Promise that callers awaited, `emit` returns `void`, so drop the `await`                         |
| `register(name, load)`                                          | `emit(name, await load())`: a function is now emitted as a value, not called                                                                |
| `register(name, () => fn)`, to publish the function `fn`        | `emit(name, fn)`, without the wrapper (see the warning below)                                                                               |
| `onReady(name, callback)`                                       | `on(name, callback)` for a channel emitted once, or the [`firstValue`](./recipes.md#wait-for-a-first-value-firstvalue) recipe for a promise |
| `emit(name, value)`                                             | `emit(name, value)`                                                                                                                         |
| `on(name, ({ data }) => …)`                                     | `on(name, value => …)`: listeners receive the value itself, without an envelope                                                             |
| `on(name, callback, { replay: 0 })`                             | the producer emits with `{ retain: false }`                                                                                                 |
| `on(name, callback, { replay: n })` with `n > 1`                | not supported: one retained value per channel (keep a list in the value if you need one)                                                    |
| `update(name, current => next)`                                 | `emit(name, next(bus.peek(name)))`                                                                                                          |
| `clear(name)` / `clear()`                                       | not supported; in tests, give each test a fresh bus (see [Testing](./recipes.md#testing))                                                   |
| `data-max-streams`, `data-max-events`, `data-remove-percentage` | not needed: each channel retains one value                                                                                                  |
| `{ data, timestamp }`                                           | put a timestamp in the value if a consumer needs one                                                                                        |

The installing line in `main.ts` was there so the registry existed before any remote ran. The bus
needs no such ordering: whichever copy is used first installs it. The one exception is the
orchestrator's `quickstart.mjs`, which only announces `orch.init-ready` on a bus that is already on the
page, so load `init-bus.js` before it.

> **Watch the function wrappers.** `register(name, () => fn)` was the way to publish a function, because
> `register` called functions. Ported literally, `emit(name, () => fn)` publishes the wrapper instead
> of `fn`. On a typed channel TypeScript catches it; on an undeclared channel (typed `unknown`) nothing
> does.

`orch.init-ready` keeps its name. The orchestrator emits it on both the registry and the bus, whichever
is on the page; see [Getting Started](./getting-started.md#waiting-for-the-orchestrator-orchinit-ready).

## Typing

The registry was typed per call, with a type argument from an app-owned interface. The bus types each
channel once, by name. Move the interface into a `Channels` augmentation (see [Typing](./typing.md)):

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

- Drop the type arguments: the type parameter of `emit`, `on` and `peek` is now the channel name, and
  the value type follows from it.
- Where you used `Events['x']` as a type (a test fixture, a helper's parameter), use `ChannelValue<'x'>`
  or the value type itself.

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
