# Releasing

The monorepo publishes six packages with [Changesets](https://github.com/changesets/changesets):

- `@theme-registry/refract` (core + CLI, incl. DTCG interop at `/dtcg`) — **stable**
- `@theme-registry/refract-css` — **stable**
- `@theme-registry/refract-styled-components` — **stable**
- `@theme-registry/refract-mcp` (MCP server bin) — **stable**
- `@theme-registry/refract-scss` — experimental
- `@theme-registry/refract-json` — experimental

The private workspaces (`@theme-registry/website`, `@theme-registry/theme-fixtures`,
`@theme-registry/integration-tests`) are `private: true` and never publish.

## Versioning model (0.x)

All six are in one **`fixed` group** (`.changeset/config.json`): they share a single version and
publish together, lockstep, through the whole `0.x` line. Internal deps use `workspace:^`, which
Changesets rewrites to `^<version>` at publish time.

At **1.0** the plan is to split the `fixed` group into independent versioning — core stable on its own
`1.x`, the experimental adapters versioning on their own churn.

## Experimental tiers = npm dist-tags, not divergent versions

Stability tiers are signalled with an npm **dist-tag**, never by giving a package a different version.
Everything shares the fixed version; the stable packages ride `latest`, the experimental adapters are
reachable via the `experimental` tag.

Because `changeset publish` applies ONE `--tag` to every package it publishes, per-package tags are a
two-lane flow:

1. `pnpm release` — `changeset publish` (all six to `latest`; the coordinated stable release).
2. After a stable release, retag the experimental adapters:
   ```sh
   V=$(node -p "require('./packages/refract-scss/package.json').version")
   npm dist-tag add @theme-registry/refract-scss@$V experimental
   npm dist-tag add @theme-registry/refract-json@$V experimental
   ```

`pnpm release:experimental` (`changeset publish --tag experimental`) is the alternative lane for
publishing a batch under `experimental` only (e.g. a pre-release with no stable counterpart).

## Cutting a release

```sh
pnpm changeset          # describe the change → writes a .changeset/*.md
pnpm version-packages   # apply pending changesets → bumps versions + CHANGELOGs
# review the version bump + changelog diff, commit
pnpm release            # build all packages + publish to npm (needs npm auth)
```
