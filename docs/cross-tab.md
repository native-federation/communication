[< back](./../README.md)

# Cross-tab

`shareAcrossTabs` mirrors a list of channels into every other tab of the same origin.

```js
import { shareAcrossTabs } from '@softarc/native-federation-communication/cross-tab';

const stop = shareAcrossTabs(['cart:changed', 'auth:user']);
```

## Why BroadcastChannel

A `CustomEvent` dispatched on `window` or `document` runs its listeners inside that one document only.
It never reaches another tab, popup or iframe, and inside one document `__NF_BUS__` already does that
job. What crosses tabs is `BroadcastChannel`, so the plugin uses it and no `CustomEvent` at all.

## Install once, in the host

Call it once, in the host, with an explicit list of channels. Channels you don't list stay in the tab.

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

`retain` carries across: a retained emit is retained in the other tab, and `{ retain: false }` clears
the other tab's retained value. `undefined` always arrives unretained.

## Live only

A new tab gets nothing until the next emit; read the initial state from the server or the URL. Emits
from two tabs at the same moment may leave the tabs with different values; there is no
last-writer-wins.

## Copies and the `bus` option

On a page, omit `bus`. Every copy then uses the page bus, so a channel listed by two copies is bridged
once. If an owner calls `stop()`, nobody takes over its channels; install again.

`bus` is for tests and isolated buses. A private `createBus()` bridged with the same channel names as
the page bus cross-talks with it, since all tabs share one wire.

## Scope

- Same origin and same storage partition only. Same-origin iframes are included.
- A tab kept in the back-forward cache is evicted when a message reaches it.
- Without `BroadcastChannel`, or without a page (Node, SSR), `shareAcrossTabs` does nothing and returns
  a no-op.
- In tests, call `stop()`: an open channel keeps Node running.
