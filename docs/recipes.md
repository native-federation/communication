[< back](./../README.md)

# Recipes

The package ships no framework adapters: `on` returns the cleanup function every framework already
asks for. These recipes are small enough to copy into your app. They import `bus` from the package;
`__NF_BUS__` works the same way.

## Angular

Subscribe in an injection context and hand `off` to `DestroyRef`. Seed the signal with `peek`, so the
component renders the retained value without waiting:

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

```ts
@Component({
  selector: 'app-cart-badge',
  template: `{{ cart()?.count ?? 0 }}`,
})
export class CartBadge {
  readonly cart = channelSignal('cart:changed');
}
```

For a command channel, subscribe directly instead: there is no value to show, only something to do.

```ts
constructor() {
  inject(DestroyRef).onDestroy(bus.on('ui:toast', ({ text }) => this.snackBar.open(text)));
}
```

`inject(DestroyRef)` works the same in a root service or in `provideAppInitializer`. There it is the
environment injector's `DestroyRef`: the listener lives as long as the app, and a `TestBed` reset
releases it instead of leaking it into the next test.

```ts
provideAppInitializer(() => {
  const router = inject(Router);
  inject(DestroyRef).onDestroy(bus.on('nav:navigate', ({ url }) => router.navigateByUrl(url)));
});
```

## React

Subscribe in an effect; `on` returns the effect's cleanup:

```tsx
useEffect(() => bus.on('ui:toast', ({ text }) => toast(text)), []);
```

For state, `useSyncExternalStore` reads the retained value without tearing. The third argument is
required for server rendering, where the bus is inert:

```tsx
import { useCallback, useSyncExternalStore } from 'react';
import { bus, type ChannelName, type ChannelValue } from '@softarc/native-federation-communication';

export function useChannel<K extends ChannelName>(channel: K): ChannelValue<K> | undefined {
  const subscribe = useCallback((onChange: () => void) => bus.on(channel, onChange), [channel]);
  return useSyncExternalStore(
    subscribe,
    () => bus.peek(channel),
    () => undefined
  );
}

function CartBadge() {
  const cart = useChannel('cart:changed');
  return <span>{cart?.count ?? 0}</span>;
}
```

This relies on producers emitting a new object for every change (see
[Pitfalls](./api.md#pitfalls)).

## RxJS

Don't pass RxJS objects across the bus. Each micro frontend bundles its own RxJS, and an `Observable`
from one bundle doesn't reliably work with operators from another. Keep everything that crosses a bundle
boundary plain JavaScript, and wrap the bus with **your own** RxJS at your own edge:

```ts
import { Observable } from 'rxjs';
import { bus, type ChannelName, type ChannelValue } from '@softarc/native-federation-communication';

export const fromChannel = <K extends ChannelName>(channel: K) =>
  new Observable<ChannelValue<K>>(subscriber => bus.on(channel, value => subscriber.next(value)));
```

`off` becomes the Observable's teardown, so `takeUntilDestroyed`, `take(1)` or `async` release the
listener. The retained value arrives synchronously on subscribe, like a `BehaviorSubject`.

To publish from a stream, subscribe and emit:

```ts
cart$.subscribe(cart => bus.emit('cart:changed', { count: cart.items.length }));
```

## Wait for a first value: `firstValue`

Promises fit app initializers, route guards, loaders and top-level `await`. `firstValue` resolves with
the retained value, or with the next emit if there is none yet. It then unsubscribes, and it rejects if
`signal` aborts first:

```ts
import { bus, type ChannelName, type ChannelValue } from '@softarc/native-federation-communication';

export function firstValue<K extends ChannelName>(
  channel: K,
  { signal }: { signal?: AbortSignal } = {}
): Promise<ChannelValue<K>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const done = new AbortController();
    const onAbort = (): void => {
      done.abort();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    bus.on(
      channel,
      value => {
        done.abort();
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      { signal: done.signal }
    );
  });
}
```

It aborts its own `AbortController` instead of calling `off`, because the retained value arrives before
`on` returns `off` (see [Pitfalls](./api.md#pitfalls)).

```ts
const { loadRemoteModule } = await firstValue('orch.init-ready');

// give up after 5 seconds
const user = await firstValue('shell:user', { signal: AbortSignal.timeout(5000) });
```

**On the server, `firstValue` never settles**, because the bus is inert there. Only await it in code
that runs in the browser. In Angular:

```ts
provideAppInitializer(() => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
  const session = inject(Session);
  return firstValue('shell:user').then(user => session.start(user));
});
```

In React, call it from effects or client-side loaders, never during a server render.

## Custom elements

One `AbortController` per connection tears down every subscription at once:

```ts
import { bus } from '@softarc/native-federation-communication';

class CartBadge extends HTMLElement {
  #connection?: AbortController;

  connectedCallback(): void {
    this.#connection = new AbortController();
    const { signal } = this.#connection;
    bus.on('cart:changed', ({ count }) => (this.textContent = String(count)), { signal });
    bus.on('shell:theme', ({ name }) => this.setAttribute('theme', name), { signal });
  }

  disconnectedCallback(): void {
    this.#connection?.abort();
  }
}

customElements.define('cart-badge', CartBadge);
```

## Testing

App code imports `bus`, which looks up `globalThis.__NF_BUS__` on every call. So give each test a fresh
bus by replacing that slot, in a setup file:

```ts
// vitest setup file
import { createBus } from '@softarc/native-federation-communication';

beforeEach(() => {
  vi.stubGlobal('__NF_BUS__', createBus());
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

The slot is read-only but configurable, which makes this possible. Without `vi.stubGlobal` (in Jest, for
example), `delete globalThis.__NF_BUS__` in a `beforeEach` works too: the next `bus` call installs a new
bus. Either way the test environment needs a `window` (jsdom or happy-dom); without one, `bus` is inert.

A bare `createBus()` only helps code that receives the bus as a parameter. Code that imports `bus`
never sees it.
