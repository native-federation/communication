[< back](./../README.md)

# Cross-tab

`broadcastTransport` is a [transport](./api.md#transports) that mirrors the listed channels into every
other tab of the same origin:

```js
import { connect } from '@softarc/native-federation-communication';
import { broadcastTransport } from '@softarc/native-federation-communication/cross-tab';

const connection = connect(broadcastTransport(), ['cart:changed', 'auth:user']);
```

## Why BroadcastChannel

A `CustomEvent` dispatched on `window` or `document` runs its listeners inside that one document only.
It never reaches another tab, popup or iframe, and inside one document `__NF_BUS__` already does that
job. What crosses tabs is `BroadcastChannel`, so the transport uses it and no `CustomEvent` at all.

## Connect once, in the host

List the channels explicitly. Channels you don't list stay in the tab.

Sync source channels, not the ones derived from them. If a listener on `cart:changed` emits
`cart:count` and both are synced, every tab gets `cart:count` twice: once from its own listener and
once from the other tab.

## What crosses

- Only values that can be [structured-cloned](https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
  The other tab gets a copy, not your object, and class instances arrive as plain objects.
- A value arrives one task later, in emit order. The local `emit` stays synchronous.
- An uncloneable value (a function, a DOM node, or an object holding one) goes to `reportError` like a
  throwing listener. The local listeners still get it, but the whole value is dropped for other tabs,
  so they keep their previous value.

`retain` carries across: a retained emit is retained in the other tab, a retained `undefined` included,
and `{ retain: false }` clears the other tab's retained value.

## Live only

A new tab gets nothing until the next emit; read the initial state from the server or the URL.
`connection.replay()` only pushes this tab's retained values to the others, overwriting theirs. Emits
from two tabs at the same moment may leave the tabs with different values; there is no
last-writer-wins.

## Copies

Every copy's `broadcastTransport()` has the same name, so a second `connect` on the same bus is refused
with a warning and its channels are not bridged. List every channel in the host's one `connect`. If
the host calls `close()`, nobody takes over; connect again.

All tabs share one wire, `native-federation-communication`. A private `createBus()` connected with
`{ bus }` on that wire cross-talks with the page bus, so give it its own:
`broadcastTransport('my-tests')`.

A `broadcastTransport()` holds one channel, so pass a new one to each `connect`; a second connect of
the same instance carries nothing.

## Scope

- Same origin and same storage partition only. Same-origin iframes are included.
- A tab kept in the back-forward cache is evicted when a message reaches it.
- Without `BroadcastChannel` (React Native, for one), the transport sends and receives nothing.
- In tests, call `connection.close()`: an open channel keeps Node running.
