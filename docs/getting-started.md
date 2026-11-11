[< back](./../README.md)

# Getting Started

## Install

### With a build (Angular, React, Vue, vanilla + bundler)

```bash
npm install @softarc/native-federation-communication
```

```ts
import { bus } from '@softarc/native-federation-communication';
```

Importing the package has no side effects. The first call on `bus` (in a browser) finds the page's bus
on `globalThis.__NF_BUS__`, or installs it there if no copy got there first. Every remote can bundle its
own copy: they all end up on the same bus. With native federation you may share the package to save a
few bytes, but you don't need to. See [Multiple copies](./multiple-copies.md).

### Without a build (a plain or server-rendered host page)

Load `init-bus.js` as a classic script, **before** any script that uses the bus:

```html
<script src="https://unpkg.com/@softarc/native-federation-communication@4/init-bus.js"></script>
```

After this script, `window.__NF_BUS__` is the page's bus. It has the same `emit`, `on` and `peek`
methods as the `bus` import, so every example in these docs works on both.

## A first state channel

A _state_ channel carries a value that late subscribers still need, such as the signed-in user, the cart
or the theme. Emit it normally: the channel retains the value.

```ts
// shell
bus.emit('shell:user', { id: 'u-42', name: 'Ada' });
```

```ts
// any remote, loaded before or after the shell emitted
const off = bus.on('shell:user', user => renderGreeting(user.name));

// later, when the remote is torn down
off();
```

If the shell already emitted, the listener is called with the retained value **before `on` returns**, and
again for every later emit. `bus.peek('shell:user')` reads the retained value without subscribing.

## A first command channel

A _command_ is something that should happen once, now, such as "show this toast" or "open the login
dialog". Replaying it to a remote that loads a minute later would be a bug. Emit it with
`retain: false`:

```ts
// any remote
bus.emit('ui:toast', { text: 'Saved', level: 'info' }, { retain: false });
```

```ts
// the shell, subscribed at startup
bus.on('ui:toast', ({ text, level }) => toaster.show(text, level));
```

Only the listeners subscribed at that moment receive it. A command also clears the channel's retained
value, so keep one kind per channel: a channel carries either state or commands.

## Waiting for the orchestrator: `orch.init-ready`

The [orchestrator](https://github.com/native-federation/orchestrator)'s `quickstart.mjs` announces
`orch.init-ready` with its loaders (`loadRemoteModule` and friends) when initialisation is done. It
emits on this bus when the bus is on the page, so a listener gets the loaders whether it subscribed
before or after initialisation finished.

**Load order matters:** load `init-bus.js` **before** `quickstart.mjs`. The orchestrator only emits on a
bus that already exists, and remotes load too late to install it in time.

```html
<!DOCTYPE html>
<html>
  <head>
    <!-- 1. The bus, before everything else -->
    <script src="https://unpkg.com/@softarc/native-federation-communication@4/init-bus.js"></script>

    <!-- 2. Your micro frontends -->
    <script type="application/json" id="mfe-manifest">
      {
        "team/mfe1": "http://localhost:3000/remoteEntry.json",
        "team/mfe2": "http://localhost:4000/remoteEntry.json"
      }
    </script>

    <!-- 3. Use the loaders, now or whenever they arrive -->
    <script>
      __NF_BUS__.on('orch.init-ready', ({ loadRemoteModule }) => {
        loadRemoteModule('team/mfe1', './Button');
        loadRemoteModule('team/mfe2', './Header');
      });
    </script>

    <!-- 4. The orchestrator -->
    <script src="https://unpkg.com/@softarc/native-federation-orchestrator@4/quickstart.mjs"></script>
  </head>
  <body>
    <my-header></my-header>
    <my-button>Click me</my-button>
  </body>
</html>
```

`orch.init-ready` is emitted once, so the listener runs once. Need a promise instead, for example in an
app initializer? See [`firstValue`](./recipes.md#wait-for-a-first-value-firstvalue). To type the
channel, see [Typing](./typing.md#typing-orchinit-ready).

## Next steps

- [API](./api.md): every delivery rule, and the pitfalls worth knowing up front.
- [Typing](./typing.md): typed channels shared between teams.
- [Recipes](./recipes.md): Angular, React, RxJS and custom elements.
