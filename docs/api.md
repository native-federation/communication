[< back](./../README.md)

# API

## Glossary

| Term               | Meaning                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| **channel**        | A name on the bus, e.g. `cart:changed`. Channels are created on first use; there is nothing to set up.        |
| **value**          | What a producer passes to `emit`. Any JavaScript value: objects, functions, class instances, `undefined`.     |
| **retained value** | The one value a channel keeps after an `emit`. New listeners receive it on subscribe; `peek` returns it.      |
| **listener**       | A function subscribed with `on`. It receives values, one at a time.                                           |
| **command**        | A value emitted with `{ retain: false }`: delivered to the listeners subscribed right now, never retained.    |

## The bus

```ts
import { bus, createBus } from '@softarc/native-federation-communication';
```

- `bus` is the page's bus. Every copy of the package on the page, and `globalThis.__NF_BUS__`, refer to
  the same one (see [Multiple copies](./multiple-copies.md)). On a server it does nothing (see
  [SSR](./multiple-copies.md#ssr)).
- `createBus()` returns a new, isolated bus that is not installed anywhere. Use it in unit tests, or for
  a bus per server request.

Both have the same shape:

```ts
type Bus = {
  readonly protocol: number;
  readonly version: string;
  emit(channel, value, options?: { retain?: boolean }): void;
  on(channel, listener: (value) => void, options?: { signal?: AbortSignal }): () => void;
  peek(channel): value | undefined;
};
```

`channel` and the value types come from [Typing](./typing.md). The methods never use `this`, so
`const { emit, on } = __NF_BUS__` works.

### `emit(channel, value, options?)`

Delivers `value` to the channel's listeners.

- By default the channel **retains** `value`, replacing any earlier retained value.
- With `{ retain: false }` the value is a **command**: it is delivered to the listeners subscribed right
  now, and the channel's retained value is cleared. Afterwards, `peek` returns `undefined` and new
  listeners receive nothing until the next retained emit.

Keep one kind per channel: a channel carries either state or commands.

### `on(channel, listener, options?)`

Subscribes `listener` and returns `off`, a function that unsubscribes it.

- If the channel has a retained value, `listener` is called with it **synchronously, before `on`
  returns**. Then it receives every later emit.
- `options.signal`: aborting the `AbortSignal` unsubscribes, exactly like calling `off`. An
  already-aborted signal subscribes nothing and replays nothing.
- `off` can be called any number of times, and also after an abort.
- Subscribing the same function twice gives two independent subscriptions; each `off` removes only its
  own.

### `peek(channel)`

Returns the channel's retained value, or `undefined` if it has none. It can't tell a retained
`undefined` apart from no value; if that matters, don't emit `undefined`.

### `protocol` and `version`

`protocol` is the version of the shared contract on `globalThis.__NF_BUS__` (`1`). `version` is the
package version of the copy that serves the page bus, useful when debugging a page with several copies.
Neither is needed in application code.

## Delivery rules

- **Order.** Every listener sees values in emit order, across all channels. When a listener emits while
  it is being called, the new value is queued, and delivered once the value in flight has reached every
  listener.
- **Replay and order.** If a listener emits from inside its own replay, it receives the replayed value
  first and then the new one, each exactly once.
- **Who receives an emit.** The listeners subscribed at the moment of the emit. A listener that
  unsubscribes before its turn is skipped. A listener that subscribes later receives the retained value
  instead (once), not the queued values that came before it.
- **Isolation.** A listener that throws doesn't affect the producer or the other listeners. The error is
  passed to `reportError` (it shows up in the console and in global error handlers as an uncaught error),
  or to `console.error` where `reportError` doesn't exist. If `reportError` itself throws, that error
  reaches the caller and the pending deliveries are dropped; during `on`'s replay the listener stays
  subscribed without an `off`, so only its `signal` can remove it.
- **Same reference.** Every listener, the replay and `peek` receive the exact value the producer
  emitted. Nothing is cloned or frozen.
- **No loop guard.** Two listeners that keep emitting to each other loop forever.

## Pitfalls

- **The first callback can't use `off`.** The replay runs before `on` returns, so inside that first call
  the returned `off` doesn't exist yet. To stop after the first value, pass a `signal` and abort it
  (see [`firstValue`](./recipes.md#wait-for-a-first-value-firstvalue)).
- **Emit a new object for every change.** Since listeners get the producer's reference, mutating an
  emitted object changes it for every listener and in the retained value. It also hides changes from
  Angular signals and React's `useSyncExternalStore`, which compare by reference. Treat emitted values
  as immutable.
- **Never assign `__NF_BUS__` yourself.** The property is read-only, so an assignment throws in module
  code (and is silently ignored in sloppy scripts). Use `init-bus.js` or the `bus` import.
- **The global may be missing.** In TypeScript, `globalThis.__NF_BUS__` is typed `Bus | undefined`: use
  `__NF_BUS__?.emit(…)`, or import `bus`, which is always there.
- **Don't generate channel names.** Each channel name keeps its retained value for the life of the page.
  A name per request or per id grows without bound; put the id in the value instead.
