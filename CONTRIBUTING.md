# Contributing

Thanks for being interested in contributing! We welcome all meaningful contributions that help improve the library.

## Getting Started

We love seeing fresh ideas and improvements! Before diving into major changes, it's usually helpful to chat with us first in an issue - we're always happy to discuss the best approach and can save you time.

The library is deliberately small. A change to the object on `globalThis.__NF_BUS__` is a change to the protocol every copy of the library on a page shares, so it can only ever add members.

## Source Code Organization

```
src/lib/            the library, published as '.'
  index.ts          the barrel: the published API (internal code never imports it)
  *.spec.ts         unit tests, next to the code they test
src/scripts/        standalone script bundles (init-bus.js)
test/               tests against the built bundles (built into test/.dist by global-setup.ts)
docs/               user documentation
build.js            esbuild bundles + tsc declarations + the dist package.json
```

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

Thanks for contributing! 🎉
