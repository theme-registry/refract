---
"@theme-registry/refract-mcp": patch
---

Fix an endless reload loop when the MCP server runs against a `.ts` `theme.config`.

Loading a `.ts` config graph-compiles it to hidden `.<base>.<pid>-<n>.mjs` files emitted beside each
compiled source (adjacency is what keeps relative sibling specifiers resolvable), which are imported and
then unlinked. Those writes and deletes matched the config watcher's source pattern and weren't ignored,
so every load woke the watcher, which reloaded, which emitted them again — a self-sustaining loop with no
user edit involved, churning the config's directory (visible in an editor as a file tree that never stops
refreshing).

The watcher now skips any hidden path — which also stops spurious reloads from `.next` / `.turbo` /
`.cache` build churn when the config sits at a monorepo root — and reloads no longer overlap, so nothing
a load writes can start another one. Edits landing mid-reload are still picked up.
