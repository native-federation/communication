[< back](./../README.md)

# Typing

Types are optional: plain JavaScript gets the full API. To check channel values, declare each channel
once in the package's `Channels` interface:

```ts
// channels.d.ts
export {}; // keeps the file a module, so this adds to the package's types instead of replacing them

declare module '@softarc/native-federation-communication' {
  interface Channels {
    'cart:changed': { count: number };
    // command: emit with { retain: false }
    'ui:toast': { text: string };
  }
}
```

```ts
bus.emit('cart:changed', { count: 3 }); // ok
bus.emit('cart:changed', { cnt: 3 }); // error
bus.on('cart:changed', ({ count }) => {}); // count: number
```

Types apply to `bus` and `createBus()`. `globalThis.__NF_BUS__` stays untyped, because every copy of the
package declares it.

## In JavaScript

Keep the same `channels.d.ts` and start a `.js` file with `// @ts-check` (or set `checkJs` in
`jsconfig.json`). Your editor then completes channel names and flags wrong values. In JSDoc, name a
value type as `import('@softarc/native-federation-communication').ChannelValue<'cart:changed'>`.

## What the types don't catch

- **A misspelt name is just another channel.** It compiles, with an `unknown` value. Export the names as
  constants from your contracts module.
- **An undeclared channel is `unknown`**, not `any`: narrow the value before you use it.
- **Commands.** Mark them in the declaration, as above, and emit them through one typed helper:

  ```ts
  export const showToast = (toast: ChannelValue<'ui:toast'>): void =>
    bus.emit('ui:toast', toast, { retain: false });
  ```

- **Other deploys.** A deployed producer can still send a shape a deployed consumer doesn't expect.

## Sharing the declarations

Every producer and consumer must see the declaration: put it in a types-only contracts package that
each remote includes, or copy the `.d.ts` into each repo (simpler, but copies drift). Two different
types for one channel are a compile error, which shows the drift at build time.

## Evolving a channel

- Name channels `team:subject:verb`, such as `checkout:cart:changed`, so ownership is clear.
- Use object values, even for one field, so you can add fields later.
- Make a breaking change under a new name, such as `cart:changed.v2`, and emit both until every
  consumer has moved.
