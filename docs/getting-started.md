[< back](./../README.md)

# Getting started

TypeScript is optional; to check channel values, see [Typing](./typing.md).

## Install

### With a bundler

```bash
npm install @softarc/native-federation-communication
```

The host installs the bus once, before any code uses it. Make it the first import of the module that
`initFederation` loads, often `bootstrap.ts`: in a Native Federation host, shared packages such as
this one resolve only after `initFederation`, so `main.ts` is too early. The `quickstart.js` script
tag works anywhere.

```js
import '@softarc/native-federation-communication/quickstart';
```

The host and every remote then use the bus:

```js
import { bus } from '@softarc/native-federation-communication';
```

Every remote may bundle its own copy; they all share the one bus at `globalThis.__NF_BUS__` (see
[Multiple copies](./multiple-copies.md)). Importing `/quickstart` again, from any copy, keeps the bus
that is there. A remote that also runs on its own can import it in its standalone entry.

### With a script tag

Load `quickstart.js` as a classic script, before any script that uses the bus:

```html
<script
  src="https://unpkg.com/@softarc/native-federation-communication@4.0.0-next.1/quickstart.js"
  integrity="sha384-HASH"
  crossorigin="anonymous"
></script>
```

- Replace `HASH` with the output of `openssl dgst -sha384 -binary quickstart.js | openssl base64 -A`.
  Serving the file from your own host is better still.
- Keep the exact version: a range such as `@4` never matches a prerelease.
- The bus is then `globalThis.__NF_BUS__`, with the same methods as `bus`. Code that must survive a
  failed load calls `globalThis.__NF_BUS__?.on(…)`.

A remote without a build step can still import `bus` by name when native federation shares the package.

### Without an installed bus

`bus` works before a bus is installed, but drops every call and warns, once per copy, that no bus is
installed. It uses the installed bus from the next call on, so values emitted before that are lost.
Install it first.

## State

A state channel keeps its last value for listeners that come later: the user, the cart, the theme.

```js
// shell
bus.emit('shell:user', { id: 'u-42', name: 'Ada' });

// any remote, loaded before or after: called now if a value exists, and on every later emit
const off = bus.on('shell:user', user => renderGreeting(user.name));
off(); // when the remote is torn down
```

## Commands

A command should happen once, now, such as showing a toast. Emit it with `{ retain: false }`, through
one helper per channel, so no call site can forget the option:

```js
// toast.js: the only place that emits ui:toast
export const showToast = toast => bus.emit('ui:toast', toast, { retain: false });

// shell: { replay: false } ignores a stale command if a producer forgot retain: false
bus.on('ui:toast', ({ text }) => toaster.show(text), { replay: false });
```

Keep one kind per channel: state or commands. Values come from other deploys, so check them before you
trust them.

Next: the [API](./api.md) and its pitfalls, then the [Recipes](./recipes.md).
