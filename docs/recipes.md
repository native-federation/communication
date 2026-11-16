[< back](./../README.md)

# Recipes

There are no framework adapters: `on` returns the cleanup function every framework asks for. Copy what
you need.

## Angular

Hand `off` to `DestroyRef`, and seed the signal with `peek` so the first render has the value:

```ts
import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { bus, type ChannelName, type ChannelValue } from '@softarc/native-federation-communication';

export function channelSignal<K extends ChannelName>(
  channel: K
): Signal<ChannelValue<K> | undefined> {
  const value = signal(bus.peek(channel));
  inject(DestroyRef).onDestroy(bus.on(channel, next => value.set(next)));
  return value.asReadonly();
}
```

A command has nothing to show, so subscribe directly. In `provideAppInitializer` or a root service the
listener lives as long as the app, and a `TestBed` reset removes it:

```ts
provideAppInitializer(() => {
  const router = inject(Router);
  inject(DestroyRef).onDestroy(bus.on('nav:navigate', ({ url }) => router.navigateByUrl(url)));
});
```

## React

For a command, `on` is the effect's cleanup:
`useEffect(() => bus.on('ui:toast', ({ text }) => toast(text)), [])`. For state:

```js
import { useCallback, useSyncExternalStore } from 'react';
import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @returns {import('@softarc/native-federation-communication').ChannelValue<K> | undefined}
 */
export function useChannel(channel) {
  const subscribe = useCallback(onChange => bus.on(channel, onChange), [channel]);
  return useSyncExternalStore(
    subscribe,
    () => bus.peek(channel),
    () => undefined
  );
}
```

## RxJS

Each micro frontend bundles its own RxJS, so send plain values over the bus and wrap it with your own:

```js
import { Observable } from 'rxjs';
import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @returns {Observable<import('@softarc/native-federation-communication').ChannelValue<K>>}
 */
export const fromChannel = channel =>
  new Observable(subscriber => bus.on(channel, value => subscriber.next(value)));
```

`off` becomes the teardown, and the retained value arrives on subscribe, like a `BehaviorSubject`.

## `firstValue`

For app initializers, guards and top-level `await`: resolves with the retained or the next value, then
unsubscribes. It aborts its own controller, because `off` doesn't exist yet during the first call.

```js
import { bus } from '@softarc/native-federation-communication';

/**
 * @template {import('@softarc/native-federation-communication').ChannelName} K
 * @param {K} channel
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('@softarc/native-federation-communication').ChannelValue<K>>}
 */
export function firstValue(channel, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const done = new AbortController();
    const stop = signal ? AbortSignal.any([signal, done.signal]) : done.signal;
    if (stop.aborted) return reject(signal?.reason);
    stop.addEventListener('abort', () => reject(signal?.reason));
    bus.on(channel, value => (resolve(value), done.abort()), { signal: stop });
  });
}
```

```js
const user = await firstValue('shell:user', { signal: AbortSignal.timeout(5000) });
```

Await it only in the browser: on a server it may never settle.

## Custom elements

One `AbortController` per connection removes every subscription at once:

```js
import { bus } from '@softarc/native-federation-communication';

class CartBadge extends HTMLElement {
  #connection;

  connectedCallback() {
    this.#connection = new AbortController();
    const { signal } = this.#connection;
    bus.on('cart:changed', ({ count }) => (this.textContent = String(count)), { signal });
    bus.on('shell:theme', ({ name }) => this.setAttribute('theme', name), { signal });
  }

  disconnectedCallback() {
    this.#connection?.abort();
  }
}

customElements.define('cart-badge', CartBadge);
```

## Server-side rendering

A process-wide bus would show one user's values to the next, so never import `/install` in server
code: only in the browser or React Native entry. Without an installed bus, server code gets the inert
bus, which drops every call and warns once. For a bus per request, install, once at boot, a
[`busFrom`](./api.md#entry-points) bus that looks up the current request's own bus on every call:

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import { busFrom, createBus, installNFBus } from '@softarc/native-federation-communication/setup';

const requests = new AsyncLocalStorage();

export function installRequestBus() {
  const requestBus = busFrom(() => requests.getStore());
  // a bus installed earlier would be shared by every request, so refuse to run on top of it
  if (installNFBus(requestBus) !== requestBus)
    throw new Error('__NF_BUS__ already holds another bus.');
}

export const withRequestBus = handle => requests.run(createBus(), handle);
```

```js
installRequestBus();
server.on('request', (req, res) => withRequestBus(() => render(req, res)));
```

`installRequestBus` throws when something installed a bus first, since every request would share
that one. Every copy uses what is in `__NF_BUS__`, so the host and every remote's server code share
the request's bus, across `await` too. Outside a request the store is empty, so a call goes to the
[inert bus](./api.md#without-an-installed-bus): its arguments are checked, then it is dropped with one
warning. With a browser and a server entry, keep the `/install` import in the browser one (in a
federated host, its `bootstrap.ts`), and call `installRequestBus()` from the server one.

## React Native and WebView

React Native has a bus of its own, and so has each page in a `react-native-webview`. Bridge them with
[`connectTransport`](./api.md#connecttransporttransport-channels-options) and one
[transport](./api.md#transports) per side. Each side installs its bus once, first thing in its entry
(the app's `index.js`; in a federated page, the module `initFederation` loads), with
`import '@softarc/native-federation-communication/install';`, and imports `bus` and
`connectTransport` from the main entry. `/transport/broadcast-channel` isn't needed, and Metro
resolves the package's `exports` by default from React Native 0.79.

The page posts to `window.ReactNativeWebView`, which exists once the `WebView` has `onMessage`, and
receives through a global of its own that the app calls. `connectTransport` calls `listen` once it
is connected, so that is where the page tells the app it is ready, with a message of its own that is
not an envelope:

```js
import { connectTransport } from '@softarc/native-federation-communication';

const app = {
  name: 'react-native',
  send: envelope => window.ReactNativeWebView?.postMessage(JSON.stringify(envelope)),
  listen: receive => {
    window.__SHOP_FROM_APP__ = json => receive(JSON.parse(json));
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'webview-ready' }));
    return () => delete window.__SHOP_FROM_APP__;
  },
};

connectTransport(app, ['cart:changed', 'auth:user']);
```

The app injects a call to that global, with the JSON encoded twice so it is a string literal, and gets
the page's messages from `onMessage`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import { connectTransport } from '@softarc/native-federation-communication';

function webViewTransport(name, webView, onReady) {
  let receive = () => {};
  return {
    name,
    send: envelope => {
      const json = JSON.stringify(JSON.stringify(envelope));
      webView.current?.injectJavaScript(`window.__SHOP_FROM_APP__?.(${json}); true;`);
    },
    listen: next => {
      receive = next;
      return () => (receive = () => {});
    },
    onMessage: ({ nativeEvent: { data } }) => {
      const message = parse(data);
      if (message?.type === 'webview-ready') onReady();
      else receive(message);
    },
  };
}

// Other libraries post on the same channel; connectTransport ignores what is not an envelope.
function parse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function Shop() {
  const webView = useRef(null);
  const connection = useRef(null);
  const [transport] = useState(() =>
    webViewTransport('webview:shop', webView, () => connection.current?.replayRetained())
  );

  useEffect(() => {
    connection.current = connectTransport(transport, ['cart:changed', 'auth:user']);
    return () => connection.current?.close();
  }, [transport]);

  return (
    <WebView
      ref={webView}
      source={{ uri: 'https://shop.example.com' }}
      onMessage={transport.onMessage}
    />
  );
}
```

- Values cross as JSON: functions and `undefined` fields are dropped, a `Date` arrives as a string.
- A loaded or reloaded page starts empty, so the app sends its retained values with
  `replayRetained()` when the page posts `{ type: 'webview-ready' }`. Not on `onLoadEnd`: a federated
  page often connects after its load event.
- Give each `WebView` its own transport name, since a bus connects a name once.
- The injected script ends with `true;`, as react-native-webview asks.

## Testing

App code imports `bus`, which reads `globalThis.__NF_BUS__` on every call. Put a fresh bus from
`createBus()` there in a setup file; no DOM environment is needed:

```js
import { createBus } from '@softarc/native-federation-communication/setup';

beforeEach(() => {
  vi.stubGlobal('__NF_BUS__', createBus());
  // a listener that throws, a failed expect included, now fails the emit and so the test
  vi.stubGlobal('reportError', error => {
    throw error;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

A rethrown error also skips that `emit`'s remaining deliveries, which is fine in a test. Without
`vi.stubGlobal`, use
`Object.defineProperty(globalThis, '__NF_BUS__', { value: createBus(), configurable: true })`: a
plain assignment throws once `/install` or `installNFBus` has filled the slot. Code that takes the
bus as a parameter can get a `createBus()` of its own instead.
