[< back](./../README.md)

# API

## Entry points

Every subpath is under `@softarc/native-federation-communication`:

| Import                         | Exports                                            | For                                                      |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| the package                    | `bus`, `connectTransport`, every type              | Everyone                                                 |
| `/install`                     | nothing: it installs a bus                         | The host, once                                           |
| `/setup`                       | `createBus`, `busFrom`, `getNFBus`, `installNFBus` | Custom installs, servers, tests                          |
| `/domain`                      | every type, and the `__NF_BUS__` global            | Contracts packages: types without runtime code           |
| `/transport/broadcast-channel` | `broadcastChannelTransport`                        | [Cross-tab](./cross-tab.md)                              |
| `/install.js`                  | a classic script that installs a bus               | The [script tag](./getting-started.md#with-a-script-tag) |

`/domain` exports the same types as the package itself. Augment `Channels` on the package name,
never on `/domain`: see [Typing](./typing.md#what-the-types-dont-catch).

```js
import { bus, connectTransport } from '@softarc/native-federation-communication';
import {
  busFrom,
  createBus,
  getNFBus,
  installNFBus,
} from '@softarc/native-federation-communication/setup';
```

- `bus` serves whatever is installed at `globalThis.__NF_BUS__`, looked up on every call, so every
  copy of the package uses the same bus. With nothing installed it is
  [inert](#without-an-installed-bus).
- `createBus()` returns a new bus that is installed nowhere: for code that takes the bus as a
  parameter, for tests, or to install yourself.
- `getNFBus()` returns the value at `globalThis.__NF_BUS__` as is, unchecked, or `undefined`.
- `installNFBus(instance)` installs `instance` at `globalThis.__NF_BUS__` if nothing is there, and
  returns whichever bus is there afterwards. The first install wins: it never replaces a bus that
  others use, so compare the result with `instance` to know whether yours is the page bus. The slot
  is read-only, so a stray assignment throws in strict mode instead of splitting the page.
- `busFrom(getBus)` returns a frozen bus that calls `getBus()` on every call and uses the bus it
  returns, or the [inert](#without-an-installed-bus) bus when that is `undefined`. `protocol`,
  `version` and `tap` are resolved the same way. `bus` is `busFrom(getNFBus)`. A `getBus` that is
  not a function throws a `TypeError` at once.

Install a bus from `createBus()`, never `bus` or another `busFrom` bus that reads `__NF_BUS__`: it
would resolve to itself, and its first call throws:

```text
[native-federation-communication] This busFrom bus resolves to itself, e.g. the package's `bus` was given to installNFBus. Install a bus from createBus() instead.
```

`/install` is `installNFBus(createBus())`. A bus kept anywhere else, such as in an iframe or a DI
container, goes through `busFrom`:

```js
const frameBus = busFrom(() => iframe.contentWindow?.__NF_BUS__);
frameBus.emit('cart:changed', { count: 3 }); // dropped until the iframe installs a bus
const scopedBus = busFrom(() => container.resolve('bus')); // whatever the container holds now
```

Pass such a bus to [`connectTransport`](#connecttransporttransport-channels-options) as `{ bus }`.
The facade has `tap` only while the bus behind it has one, so `connectTransport` refuses it until
then:

```js
const connection = connectTransport(transport, ['cart:changed'], { bus: frameBus });
```

## The bus

`bus` and every bus from `createBus()` have this shape, written as a TypeScript type. The methods
never use `this`.

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
  tap?(name: string, listener: TapListener): Tap | undefined; // see tap below
};
```

A channel is any string and exists from first use. A value can be anything, functions included.

`Bus` is the typed view; `NativeFederationBus` is the untyped shape at `__NF_BUS__`. Write code
against `Bus`.

**Options.** A missing or `undefined` option means its default; any other value is read as a boolean,
so `{ retain: 0 }` is `{ retain: false }` and `{ retain: 'false' }` retains. Unknown options are
ignored. One exception: `connectTransport`'s `{ bus: undefined }` is
[refused](#connecttransporttransport-channels-options), not read as the page bus.

**Errors.** Every method throws a `TypeError` if `channel` is not a string, and `on` if `listener` is
not a function or `signal` is an `AbortController` instead of its `signal`. The message names what
was expected and what it got, such as `A channel must be a string, got number.`

## `emit(channel, value, options?)`

Delivers `value` to the channel's listeners, and the channel retains it in place of the previous
value. With `{ retain: false }` the value is a command: only current listeners get it, and it also
clears the channel's retained value, so a later `on` or `peek` finds nothing.

## `on(channel, listener, options?)`

Subscribes `listener` and returns `off`, which unsubscribes it and is safe to call twice.

- A retained value is delivered before `on` returns, then every later emit. Replay is at most one
  value, the last retained one, not a buffer like RxJS's `ReplaySubject`.
- `{ replay: false }` skips the retained value.
- `{ signal }`: aborting it unsubscribes. An aborted signal subscribes nothing.

## `peek(channel)`

Returns the retained value, or `undefined`. A retained `undefined` looks the same as none.

## `tap(name, listener)`

The extension point for bridges: `listener` sees every emit on every channel. To bridge channels, use
[`connectTransport`](#connecttransporttransport-channels-options), which is built on it.

```ts
type Envelope = { channel: string; value: unknown; retain: boolean };
type TapListener = (envelope: Envelope) => void;
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
- It returns `undefined` if a tap or transport with that `name` is open on this bus, and throws a
  `TypeError` if `name` is not a string (`A tap name must be a string, …`) or `listener` not a
  function (`A tap listener must be a function, …`).
- The tap listener runs after the emit's listeners, so it sees values in the order they do, with the
  emit's `retain`. A throwing tap listener is reported like a throwing listener.
- `tap.emit` is `bus.emit`, except that this tap's own listener doesn't see it. Emits that listeners
  make in response are ordinary emits.
- `tap.replay()` calls this listener once per channel with a retained value, a retained `undefined`
  included, with `retain: true`: at most one value per channel.
- `tap.close()` removes the tap and frees its name; `emit` and `replay` then do nothing. It is safe to
  call twice.

## `connectTransport(transport, channels, options?)`

Bridges the listed channels to a bus on the other side of a transport: another tab, a WebView, a
native app.

```js
import { connectTransport } from '@softarc/native-federation-communication';

const connection = connectTransport(transport, ['cart:changed', 'auth:user']);
connection?.replayRetained(); // send this side's retained values, e.g. when the other side (re)loads
connection?.close(); // stop both directions; safe to call twice
```

- Every emit on a listed channel is sent, with its `retain`. Every envelope received for a listed
  channel is emitted on this side and not sent back. Other channels and anything that is not an
  envelope are ignored.
- `{ bus }` connects another bus, such as one from `createBus()` or `busFrom(getBus)`, instead of the
  page bus. An explicit `{ bus: undefined }`, such as an iframe's empty slot, is refused, never
  replaced by the page bus.
- `replayRetained()` sends this side's retained values, at most one per channel, and overwrites the
  other side's. It doesn't ask the other side for anything.
- When [refused](#a-refused-connection), `connectTransport` warns and returns `undefined`.
- A `send` that throws is reported like a throwing listener. Local listeners have the value already.
- A transport without a string `name` (`A transport name must be a string, …`), a channel that is
  not a string, or a transport without a `listen` function throws a `TypeError`. A `send` that is
  not a function is reported on each emit.

### A refused connection

The warning names `transport.name` and the cause:

```text
[native-federation-communication] Transport 'broadcast:native-federation-communication/1' is not connected: no bus is installed.
```

The cause is one of:

- `options.bus is undefined`
- `options.bus has no tap`
- `no bus is installed`
- `the installed bus has no tap (an older copy installed it)`
- `the name is already taken on this bus by a tap or transport`

### Transports

A transport carries [envelopes](#tapname-listener) to the other side.
[`broadcastChannelTransport`](./cross-tab.md) is built in;
[React Native](./recipes.md#react-native-and-webview) shows one you write yourself.

```ts
type Transport = {
  readonly name: string;
  send(envelope: Envelope): void;
  listen(receive: (envelope: Envelope) => void): () => void; // returns the cleanup
};
```

A received envelope's `retain` follows `emit`'s rules.

`Transport`, `Envelope`, `Connection` and `ConnectTransportOptions` are exported types. A transport
follows six rules:

- **`send` never delivers back to the sender's own side.** An echo would reach its listeners twice.
- **Values must survive the encoding.** JSON drops functions and `undefined` fields; structured clone
  turns class instances into plain objects and rejects functions.
- **`name` is its tap name; taps and transports share one namespace per bus.** Use `kind:id` names
  like `broadcast:<wire>` or `webview:shop`. A second `connectTransport` with a taken name warns and
  returns `undefined`, which keeps two copies of the same transport from bridging twice.
- **`listen` may throw; `connectTransport` then closes the tap and rethrows.**
- **`send` is fire-and-forget: a synchronous throw is reported; an async `send` handles its own
  rejections.**
- **Connections form a tree.** A value received over one connection is sent on by the bus's other
  connections, so one bus can join tabs and a WebView. A cycle sends values around forever.

## Without an installed bus

Until a bus is installed, `bus` is inert, and so is a `busFrom` bus while its getter returns
`undefined`. It checks `channel` on every method and `listener` on `on`, throwing the same
`TypeError`s as a real bus, then drops the call; it does not check `signal` or other options. `emit`
delivers nothing, `on` returns an `off` that does nothing, `peek` returns `undefined`, and `tap` is
`undefined`. The first dropped call warns, once per copy of the package, naming that call:

```text
[native-federation-communication] No bus is available here, so emit('cart') and every later call until one is installed are dropped; listeners added now are lost. The host installs a bus with '@softarc/native-federation-communication/install'.
```

The method is `emit`, `on` or `peek`. A remote doesn't install a bus of its own: the host does.

`bus` serves an installed bus from the next call on; listeners added to the inert bus stay lost.

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
  plain variable that the next assignment replaces, which splits the page. Install with
  `installNFBus`. Tests replace the bus as in [Testing](./recipes.md#testing).
- **Don't delete `__NF_BUS__` on a live page.** Every copy turns inert, and the listeners on the old
  bus never hear from a new one.
- **Don't generate channel names.** Each name keeps its value for the life of the page. Put ids in the
  value.
