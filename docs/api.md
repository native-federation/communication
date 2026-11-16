[< back](./../README.md)

# API

```js
import { bus, createBus } from '@softarc/native-federation-communication';
```

- `bus` is the page's bus, the same one every copy of the package and `globalThis.__NF_BUS__` use.
- `createBus()` returns a new bus that is installed nowhere: for code that takes the bus as a
  parameter, or to [install one outside a browser](./multiple-copies.md#outside-a-browser).

Both have this shape, written as a TypeScript type. The methods never use `this`.

```ts
type Bus = {
  readonly protocol: number; // the contract between copies: 1
  readonly version: string; // the package version of the copy that serves the page
  emit(channel: string, value: unknown, options?: { retain?: boolean }): void;
  on(
    channel: string,
    listener: (value: unknown) => void,
    options?: { signal?: AbortSignal; replay?: boolean }
  ): () => void;
  peek(channel: string): unknown;
  tap?(name: string, observer: TapObserver): Tap | undefined; // see tap below
};
```

A channel is any string and exists from first use. A value can be anything, functions included.

**Options.** A missing or `undefined` option means its default; any other value is read as a boolean,
so `{ retain: 0 }` is `{ retain: false }`. Unknown options are ignored.

**Errors.** Every method throws a `TypeError` if `channel` is not a string, and `on` if `listener` is
not a function or `signal` is an `AbortController` instead of its `signal`.

## `emit(channel, value, options?)`

Delivers `value` to the channel's listeners, and the channel retains it in place of the previous value.
With `{ retain: false }` the value is a command: only current listeners get it, and the channel's
retained value is cleared.

## `on(channel, listener, options?)`

Subscribes `listener` and returns `off`, which unsubscribes it and is safe to call twice.

- A retained value is delivered before `on` returns, then every later emit.
- `{ replay: false }` skips the retained value.
- `{ signal }`: aborting it unsubscribes. An aborted signal subscribes nothing.

## `peek(channel)`

Returns the retained value, or `undefined`. A retained `undefined` looks the same as none.

## `tap(name, observer)`

The extension point for bridges: `observer` sees every emit on every channel. To bridge channels, use
[`connect`](#connecttransport-channels-options), which is built on it.

```ts
type Envelope = { channel: string; value: unknown; retain: boolean };
type TapObserver = (envelope: Envelope) => void;
type Tap = {
  emit(channel: string, value: unknown, options?: { retain?: boolean }): void;
  replay(): void;
  close(): void;
};
```

```js
const tap = bus.tap?.('logger', ({ channel, value, retain }) => log(channel, value, retain));
```

- `tap` is optional on the bus type, because an older copy may have installed the page bus without it.
  Call it as `bus.tap?.(…)`.
- It returns `undefined` if a tap with that `name` is open on this bus, and throws a `TypeError` if
  `name` is not a string or `observer` not a function.
- The observer runs after the emit's listeners, so it sees values in the order they do, with the emit's
  `retain`. A throwing observer is reported like a throwing listener.
- `tap.emit` is `bus.emit`, except that this tap's own observer doesn't see it. Emits that listeners
  make in response are ordinary emits.
- `tap.replay()` calls this observer once per channel with a retained value, a retained `undefined`
  included, with `retain: true`.
- `tap.close()` removes the tap and frees its name; `emit` and `replay` then do nothing. It is safe to
  call twice.

## `connect(transport, channels, options?)`

Bridges the listed channels to a bus on the other side of a transport: another tab, a WebView, a
native app.

```js
import { connect } from '@softarc/native-federation-communication';

const connection = connect(transport, ['cart:changed', 'auth:user']);
connection?.replay(); // send this side's retained values, e.g. when the other side (re)loads
connection?.close(); // stop both directions; safe to call twice
```

- Every emit on a listed channel is sent, with its `retain`. Every envelope received for a listed
  channel is emitted on this side and not sent back. Other channels and anything that is not an
  envelope are ignored.
- `{ bus }` connects a bus from `createBus()` instead of the page bus.
- `connect` returns `undefined` when refused: when the bus has no `tap` (it then warns), or when
  its `name` is taken on that bus.
- A `send` that throws is reported like a throwing listener. Local listeners have the value already.
- A channel that is not a string, or a transport without a string `name` or a `listen` function,
  throws a `TypeError`. A `send` that is not a function is reported on each emit.

### Transports

A transport carries [envelopes](#tapname-observer) to the other side.
[`broadcastTransport`](./cross-tab.md) is built in; [React Native](./recipes.md#react-native-and-webview)
shows one you write yourself.

```ts
type Transport = {
  readonly name: string;
  send(envelope: Envelope): void;
  listen(receive: (envelope: Envelope) => void): () => void; // returns the cleanup
};
```

A received envelope's `retain` follows `emit`'s rules.

`Transport`, `Envelope`, `Connection` and `ConnectOptions` are exported types. A transport follows six
rules:

- **`send` never delivers back to the sender's own side.** An echo would reach its listeners twice.
- **Values must survive the encoding.** JSON drops functions and `undefined` fields; structured clone
  turns class instances into plain objects and rejects functions.
- **`name` is its tap name; taps and transports share one namespace per bus.** Use `kind:id` names like
  `broadcast:<wire>`. A second `connect` with a taken name returns `undefined`, which keeps two copies
  of the same transport from bridging twice.
- **`listen` may throw; `connect` then closes the tap and rethrows.**
- **`send` is fire-and-forget: a synchronous throw is reported; an async `send` handles its own
  rejections.**
- **Connections form a tree.** A value received over one connection is sent on by the bus's other
  connections, so one bus can join tabs and a WebView. A cycle sends values around forever.

## Delivery rules

- **Order.** Every listener sees values in emit order, across channels. A value emitted inside a
  listener waits until the current value has reached every listener, so that `emit` returns first.
- **Who gets it.** The listeners subscribed at the emit. One that unsubscribes before its turn is
  skipped.
- **Isolation.** A throwing listener doesn't stop the producer or the other listeners. The error goes to
  `reportError` (in a browser, reported like an uncaught error), or to `console.error` without it.
- **Same reference.** Listeners and `peek` get the producer's object. Nothing is copied or frozen,
  except values received through a [transport](#transports).
- **No loop guard.** Two listeners that keep emitting to each other loop forever.

To debug, run `__NF_BUS__.peek('cart:changed')` or `__NF_BUS__.version` in the browser console.

## Pitfalls

- **Inside the first call, `off` doesn't exist yet**, because the retained value arrives before `on`
  returns. To stop after one value, abort a `signal`, as [`firstValue`](./recipes.md#firstvalue) does.
  `{ once: true }` is not an option.
- **Unsubscribe when your component goes away.** A listener outlives its micro frontend otherwise.
- **Emit a new object for every change.** A mutated object changes for every listener, and Angular
  signals and React miss the change, because they compare references.
- **Don't declare or assign `__NF_BUS__` on a page.** A `var __NF_BUS__` in a classic script makes it a
  plain variable that the next assignment replaces, which splits the page. Tests replace the bus as in
  [Testing](./recipes.md#testing).
- **Don't delete `__NF_BUS__` on a live page.** The next call installs a new bus, and the old one's
  listeners never hear from it again.
- **Don't generate channel names.** Each name keeps its value for the life of the page. Put ids in the
  value.
