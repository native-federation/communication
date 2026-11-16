[< back](./../README.md)

# Multiple copies

Bundle the package into every remote, share it with native federation, or both: every copy on the page
uses the same bus. If you share it, leave `strictVersion` off (or `skip` the package), so two versions
don't become a native federation version conflict that this package doesn't need.

## How a copy finds the bus

The bus lives in `globalThis.__NF_BUS__`. Every copy's `bus` reads that slot on every call and uses
whatever is there, in any runtime, whichever copy installed it. There is no private fallback bus:

- **Nothing is installed**: `bus` is [inert](./api.md#without-an-installed-bus). It drops every call
  and warns once per copy, until a bus is installed.
- **The first install wins.** `/quickstart`, `quickstart.js` and `installNFBus` only fill an empty
  slot; a second install, from any copy or version, keeps the bus that is there. A host that wants a
  known version installs first.
- **A value that is not a bus is used as is** and fails on use, typically with a `TypeError`. Nothing
  checks it. Fix the page.

Only the host installs. Importing the main entry never adds a global.

## The protocol

The frozen object in `__NF_BUS__` is the contract between old and new copies:

- Copies use the bus at the slot without checking it. Code that needs a newer feature checks
  `protocol` (1), never `version`. The package major is a separate number.
- Methods may be added. A copy checks that one exists before calling it, and the types mark it optional.
- An option or behaviour an older bus would silently ignore needs a new protocol number, and callers
  check `protocol >= N` first.
- A member's type never changes, since TypeScript merges every copy's declaration of the global.
- A breaking change gets a new global name.

`tap` is such a member: a copy calls `bus.tap?.(…)`, and
[`connect`](./api.md#connecttransport-channels-options) warns and does nothing on a bus without it.
Two more contracts are shared by copies of the [cross-tab](./cross-tab.md) transport, and changing
either needs a new wire name:

- the `BroadcastChannel` name `native-federation-communication`, which also names the transport
  `broadcast:native-federation-communication`, so a bus connects it once;
- the envelope `{ channel: string, value: unknown, retain: boolean }`, which is also what a tap
  observer receives.

## Outside a browser

Node, Deno, Bun, workers and iframes:

- **An iframe** has its own global object, so its own bus. Bridge it with a
  [transport](./api.md#transports) if needed; [`broadcastTransport`](./cross-tab.md) also reaches
  same-origin iframes.
- **One user per process** (a CLI, a worker, Electron's main process): import `/quickstart` at
  startup. Never on a server that serves many users.
- **Server-side rendering**: never import `/quickstart` in server code. Install the request-scoped bus
  from [the SSR recipe](./recipes.md#server-side-rendering) at boot. Without it, the bus stays inert
  on the server, but only when every copy is this release or newer.
- **Copies older than this release** (4.0.0-next.0 and next.1) still install a bus on first use
  wherever `window === globalThis`, as on a server with a DOM shim or on Deno 1.x. On a server that is
  one bus for all requests, so install the SSR recipe's bus at boot to keep the slot taken.
