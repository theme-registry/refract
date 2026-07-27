# Releasing

The monorepo publishes seven packages with [Changesets](https://github.com/changesets/changesets).

**Six move in lockstep** (the `fixed` group):

- `@theme-registry/refract` (core + CLI, incl. DTCG interop at `/dtcg`) — **stable**
- `@theme-registry/refract-css` — **stable**
- `@theme-registry/refract-styled-components` — **stable**
- `@theme-registry/refract-mcp` (MCP server bin) — **stable**
- `@theme-registry/refract-scss` — experimental
- `@theme-registry/refract-json` — experimental

**One versions on its own** (outside the `fixed` group):

- `create-refract-theme` — the npm initializer (`npm create refract-theme`), unscoped so the
  invocation reads properly

It is deliberately excluded from the lockstep group: an initializer's version is invisible to users
(`npm create` always fetches `latest`), so binding it to the library cadence would add cascade risk
for nothing. It takes its own `patch`/`minor` changesets, and `scripts/guard-changesets.mjs` reads the
`fixed` list from the Changesets config so a `minor` here doesn't trip the 0.x cascade guard.

It depends on `@theme-registry/refract` as a **real dependency** (not a peer), via `workspace:^`. That
matters at release time — see [Ordering](#ordering-the-initializer-follows-core) below.

The private workspaces (`@theme-registry/website`, `@theme-registry/theme-fixtures`,
`@theme-registry/integration-tests`) are `private: true` and never publish.

## Ordering: the initializer follows core

`create-refract-theme` calls into `@theme-registry/refract/build` (`runCreate`,
`promptCreateAnswers`, `rawThemeImport`). Its `workspace:^` is rewritten to `^<core version>` at
publish time, so **it must never be published ahead of a core release carrying the API it uses** —
installing it would resolve a core that lacks those exports and crash on first run.

In practice one `changeset publish` handles this correctly, because it publishes any non-private
package whose version isn't already on the registry: run `pnpm version-packages` first (bumping core),
then `pnpm release` publishes core **and** the initializer, with the dependency rewritten to the
version that just went out. Only reach for a standalone initializer publish when core is unchanged.

### Does this change need the initializer republished?

**It depends on which package the changed code lives in — not on which package the user runs.**

Both of these ship behaviour to `npm create refract-theme`, and they release differently:

| Changed file | Reaches users by |
| --- | --- |
| `packages/refract/src/build/*` (the interview, the prompts, the generator) | **Core release alone.** The published initializer resolves the new core through its `^0.1.x` range — no republish. |
| `packages/create-refract-theme/src/*` (project questions, templates, flags) | **A republish of the initializer.** Nothing else can deliver it. |

This has been got wrong once: the arrow-key prompts live in core and genuinely needed no republish, and
that conclusion was then carried across to a change in the initializer's own source, which shipped a
release where `npx create-refract-theme@latest --skills` failed with `Unknown option`. The
[smoke test](#smoke-test-after-a-release) is what caught it — run it every time.

### npm token scope

The publish token is a **granular access token**. Granular tokens scope by package or by *scope* — a
`@theme-registry` grant covers packages created in that scope later, which is why a new scoped package
publishes without touching the token. `create-refract-theme` is **unscoped**, so it belongs to no
scope and had to be added to the token's allowlist by name.

That's a chicken-and-egg on a first publish: a package that doesn't exist yet can't be selected. It
was resolved once, by hand, with a short-lived **all-packages** token:

```sh
cd packages/create-refract-theme
printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > /tmp/pub.npmrc
NPM_CONFIG_USERCONFIG=/tmp/pub.npmrc pnpm publish --access public   # isolated; ~/.npmrc untouched
rm -f /tmp/pub.npmrc
```

Only needed again for the **next new unscoped package**. Publish with `pnpm`, never `npm` — only pnpm
rewrites `workspace:^` to a real range, and `npm publish` would ship a spec no consumer can resolve.

> **Outstanding:** delete that short-lived all-packages token, and add `create-refract-theme` to the
> regular publish token's allowlist — it's selectable now that the package exists. Until then the
> initializer only publishes with a broader token than it should need.

### Smoke test after a release

Workspace links hide packaging bugs — a missing dependency resolves from a sibling, and a bin that
never runs looks fine when invoked directly. Three such bugs shipped as far as a packed tarball before
being caught. So after publishing, install from the registry as a user would:

**Clear the npx cache first, or the test is a lie.** `npx` keys its cache directory on the package
*spec*, not on the resolved dependency tree — so when the initializer's own version hasn't changed,
`create-refract-theme@latest` still resolves to the same version, npx finds a matching install on disk
and reuses it **along with the core version pinned inside it at first run**. You get last release's
code and no indication anything is stale.

```sh
rm -rf ~/.npm/_npx/*/            # or just the entry holding create-refract-theme
cd $(mktemp -d)
npx --prefer-online create-refract-theme@latest my-theme --yes --skills --mcp
cd my-theme && npm install && npm run build && npm run audit && npm run typecheck
```

`--prefer-online` additionally revalidates registry metadata, which `~/.npm/_cacache` holds with a TTL
— relevant in the minutes right after a publish.

Expect a `dist/css/theme.css`, `7/7 pass, 0 fail`, and — with the agent flags — the skills and
`.mcp.json`. Confirm the resolved core is the version you just published:

```sh
node -p "require('@theme-registry/refract/package.json').version"
```

## Versioning model (0.x)

The six above are in one **`fixed` group** (`.changeset/config.json`): they share a single version and
publish together, lockstep, through the whole `0.x` line. Internal deps use `workspace:^`, which
Changesets rewrites to `^<version>` at publish time.

At **1.0** the plan is to split the `fixed` group into independent versioning — core stable on its own
`1.x`, the experimental adapters versioning on their own churn.

### Through 0.x, release **patch-only**

Author only `patch` changesets while the group is on `0.x`. A `minor`/`major` changeset pushes core out
of the adapters' published `^0.1.x` peer range, and Changesets then **cascades the whole fixed group to
`1.0.0`** at `changeset version` time (the surprise that forced the first release to be hand-published).
In `0.x`, semver makes no minor/patch compatibility promise anyway — communicate features in the
CHANGELOG, not the version slot. The first real minor/major **is** the 1.0 split above.

This is enforced: **`scripts/guard-changesets.mjs`** runs at the front of `pnpm version-packages` and as a
CI step, and fails if any pending changeset declares `minor`/`major` while core is `0.x`. Once core is
`>= 1.0` the guard is a no-op and normal semver resumes.

> If you ever *do* want a pre-1.0 `0.2.0` feature release, it needs two changes together: enable
> `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange` in the
> changeset config **and** widen the four adapters' peer range from `workspace:^` to `>=0.1.0 <1.0.0`
> (which loosens the matched-set guarantee). Prefer waiting for 1.0.

## Experimental tiers = npm dist-tags, not divergent versions

Stability tiers are signalled with an npm **dist-tag**, never by giving a package a different version.
Everything shares the fixed version; the stable packages ride `latest`, the experimental adapters are
reachable via the `experimental` tag.

Because `changeset publish` applies ONE `--tag` to every package it publishes, per-package tags are a
two-lane flow:

1. `pnpm release` — `changeset publish` (everything pending to `latest`; the coordinated stable release).
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
