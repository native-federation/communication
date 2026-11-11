[< back](./../README.md)

# Typing

Channels are typed by adding them to the package's `Channels` interface through
[declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation).
Once declared, `emit`, `on` and `peek` check and infer the value type from the channel name:

```ts
// channels.d.ts
export {};

declare module '@softarc/native-federation-communication' {
  interface Channels {
    'cart:changed': { count: number };
    'ui:toast': { text: string; level?: 'info' | 'error' };
  }
}
```

The file must be a module (it has an `import` or `export`, hence the `export {}`). Without one, TypeScript
reads the block as a new declaration of the whole package, replacing its real types instead of adding to
them.

```ts
bus.emit('cart:changed', { count: 3 }); // ok
bus.emit('cart:changed', { cnt: 3 }); // type error: 'cnt' is not a known property
bus.on('cart:changed', ({ count }) => {}); // count: number
bus.peek('cart:changed'); // { count: number } | undefined
```

A channel nobody declared is typed `unknown`, not `any`. It still works, but you have to narrow the value
before you use it, which is the honest type for data that comes from another deploy:

```ts
bus.on('someone:else', value => {
  if (typeof value === 'object' && value !== null && 'id' in value) {
    /* … */
  }
});
```

## Sharing the declarations between teams

The declaration has to be visible to both the producer and the consumers. Two common setups:

- **A contracts package** (types only), e.g. `@acme/channel-contracts`, containing the
  `declare module` block above in a `.d.ts` file that every remote includes (through `types` in
  `tsconfig.json`, or one `import type {} from '@acme/channel-contracts'`).
- **A shared `.d.ts`** copied into each repo. Simple, but the copies can drift.

Two teams that declare the same channel with different types get a compile error ("Subsequent property
declarations must have the same type"). That is useful: it shows contract drift at build time.

## Command channels

Whether a value is a command is decided at each `emit`, and the types can't express it. Forget
`{ retain: false }` once, and the channel retains a stale command that every later listener receives.
Two habits keep that from happening:

- Mark the channel where it is declared:

  ```ts
  interface Channels {
    // command: emit with { retain: false }
    'nav:navigate': { url: string };
  }
  ```

- Emit it through one helper per app, and only through that:

  ```ts
  import { bus, type ChannelValue } from '@softarc/native-federation-communication';

  export const navigate = (value: ChannelValue<'nav:navigate'>): void =>
    bus.emit('nav:navigate', value, { retain: false });
  ```

## Types are a promise, not a guarantee

Producer and consumer are built and deployed separately, so nothing stops a deployed producer from
sending a shape that a deployed consumer doesn't expect. Keep the contracts easy to evolve:

- **Name channels `team:subject:verb`**, e.g. `checkout:cart:changed` or `shell:user:signed-in`, so
  ownership is clear and names don't collide. Short names like `cart:changed` are fine inside one
  product; dotted names such as `orch.init-ready` also work.
- **Use object values**, even for a single field (`{ count: 3 }`, not `3`), so fields can be added
  without breaking anyone.
- **Make a breaking change under a new name**: `cart:changed.v2`. Emit both names until every consumer
  has moved, then stop emitting the old one.

## Typing `orch.init-ready`

The orchestrator emits its loaders on `orch.init-ready` (see
[Getting Started](./getting-started.md#waiting-for-the-orchestrator-orchinit-ready)). Its value has the
orchestrator's `NativeFederationResult` type:

```ts
import type { NativeFederationResult } from '@softarc/native-federation-orchestrator';

declare module '@softarc/native-federation-communication' {
  interface Channels {
    'orch.init-ready': NativeFederationResult;
  }
}
```
