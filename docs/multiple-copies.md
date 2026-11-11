[< back](./../README.md)

# Multiple copies

Micro frontends are built and deployed independently, so a page often holds several copies of this
package, sometimes in different versions: one bundled into each remote, one from `init-bus.js`, one
shared through native federation. They must all talk over **one** bus, or a value emitted by one
remote never reaches another.

## How copies find each other

The bus lives on the page, not in the package: `globalThis.__NF_BUS__`. Every copy goes through the same
steps the first time `bus` is used (never at import time):

1. **No `window`** (server-side rendering, a worker): use an inert bus that does nothing. See
   [SSR](#ssr).
2. **A bus is already installed** (`__NF_BUS__.protocol` is a number `>= 1`): use it, whichever copy or
   version installed it.
3. **Something else is in `__NF_BUS__`**: leave it untouched, warn once in the console and fall back to
   a private bus. That copy's channels don't reach the rest of the page, so fix the page.
4. **Nothing installed yet**: install a new bus as a read-only, non-enumerable property and use it.

`init-bus.js` runs exactly these steps once, immediately. Loading it twice, or loading it after a remote
already installed the bus, is harmless.

So with native federation, **sharing the package is only a size optimisation**. Bundle it into every
remote, share it, or end up with two versions that were not shared: all copies converge on the same bus,
so the `shared` configuration can't break communication.

## The protocol

The object on `__NF_BUS__` is the real contract between copies, more than the TypeScript API. Its rules:

- `protocol` is `1`. Copies check `protocol`, never `version`; `version` is informational, and the
  package major and the protocol are independent (4.x ships protocol 1, and 5.0 may too).
- Protocol 1 is **append-only**: methods and option fields can be added, never changed or removed.
- A bus ignores option fields it doesn't know. So a newer copy that relies on something added in
  protocol `N` first checks `__NF_BUS__.protocol >= N`.
- A breaking change gets a **new global key**, never a changed member.
- There is no semver parsing at runtime.

The bus object is frozen, and its methods never use `this`.

## Iframes and workers

- **Iframes** are separate realms with their own `globalThis`, so each iframe gets its own bus. Bridge
  with `postMessage` yourself if you need to; values then get structured-cloned.
- **Workers** have no `window`, so `bus` is inert there. Use `createBus()` if a worker needs a bus of
  its own.

## SSR

On a server, one module instance serves every request. A page-wide bus there would replay one user's
retained value into another user's render. So:

- Importing the package touches no globals.
- Without `window`, `bus` is inert: `emit` does nothing, `on` never calls the listener and returns a
  no-op, `peek` returns `undefined`. There is no warning.
- `init-bus.js` evaluated without `window` does nothing and doesn't throw.
- Server code that really needs a bus creates one per request with `createBus()` and passes it along
  through its own dependency injection.

Code that waits for a value on the server waits forever. See the SSR notes in [Recipes](./recipes.md):
guard `firstValue` with `isPlatformBrowser`, and pass `getServerSnapshot` to `useSyncExternalStore`.
