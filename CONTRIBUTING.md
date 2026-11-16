# Contributing

Thanks for being interested in contributing! We welcome all meaningful contributions that help improve the library.

## Getting Started

We love seeing fresh ideas and improvements! Before diving into major changes, it's usually helpful to chat with us first in an issue - we're always happy to discuss the best approach and can save you time.

The library is deliberately small. The object on `globalThis.__NF_BUS__` is the protocol that every copy on a page shares, and old copies stay on pages for years. So:

- Members can be added, never changed or removed. A member's type never changes either, and a new one is optional in the types.
- An option or behaviour that an older bus would silently ignore needs a new `protocol` number.
- A breaking change needs a new global name.

## Source Code Organization

```
src/index.ts                         '.': bus, connect and the types
src/domain.ts                        './domain': the types only
src/setup.ts                         './setup': createBus, busFrom, getNFBus and installNFBus
src/install.ts                       './install' and './install.js': installs a bus, nothing else
src/transport/broadcast-channel.ts   './transport/broadcast-channel': broadcastChannelTransport
src/lib/domain/                      the contracts (*.contract.ts) and their barrels, per area
src/lib/bus/create-bus.ts            the bus itself, tap included
src/lib/global/slot.ts               getNFBus and installNFBus: reading and filling __NF_BUS__
src/lib/global/bus-from.ts           busFrom: a bus facade over a getter, and the inert bus it falls back to
src/lib/global/global-bus.ts         bus: busFrom(getNFBus)
src/lib/connect/connect.ts           connect: a transport bridged through a tap
src/lib/transport/                   broadcastChannelTransport
test/                                tests against the build (test/.dist, built by global-setup.ts)
test/recipes/                        the plain-JS recipes from docs/recipes.md, run by test/recipes.spec.ts
docs/                                user documentation
build.js                             esbuild bundles, tsc declarations and the dist package.json
```

Unit tests (`*.spec.ts`) sit next to the code they test. `./package.json` is exported as well.

## Quick Start

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Build the library: `pnpm build`
4. Create a branch: `git checkout -b my-feature`
5. Make your changes
6. Verify (the same steps CI runs):
   - `pnpm tsc --noEmit -p tsconfig.json`
   - `pnpm lint`
   - `pnpm knip`
   - `pnpm test`
   - `pnpm audit --audit-level high`
7. Push your branch and open a PR

## Pull Request Guidelines

- Include tests for any new features
- Update documentation if needed
- Follow our coding style (eslint)
- Keep PRs focused - one feature or bug fix per PR

## Commit Messages

Please use clear commit messages:

```
feat: add new feature
fix: resolve issue
docs: update readme
```

## Need Help?

Open an issue if you:

- Find a bug
- Want to suggest a feature
- Have questions about the code

Thanks for contributing!
