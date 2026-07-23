---
name: troubleshooting
description: Diagnose refract build errors — map createTheme's validation messages (unknown token/breakpoint/variant/state, cyclic or duplicate recipes, mode overrides nothing) to their cause and fix. Use when createTheme or refract build throws. Triggers: "createTheme throws", "references unknown token/breakpoint/variant", "state not allowed", "cyclic recipe", "duplicate recipe name", "overrides nothing".
tier: optional
---

# Troubleshooting

refract validates the theme up front and throws a message that **names the offending reference**.
Read the quoted name first — it points straight at the authoring mistake. Common errors and fixes:

Every authoring/build error is a **`RefractError`** with a stable machine `code` (`err.code`, e.g.
`REFRACT_E_COLOR_INPUT`, `REFRACT_E_STEPS`, `REFRACT_E_NAMING`) you can branch on without matching the
message text. Post-build reference validation **collects all failures** and throws them at once as
`REFRACT_E_VALIDATION` — `err.failures` is the array of every bad reference, so fix them in one pass:

```ts
import { RefractError } from "@theme-registry/refract";
try { createTheme(raw, { adapter }); }
catch (e) {
  if (e instanceof RefractError && e.code === "REFRACT_E_VALIDATION") console.error(e.failures);
}
```

## `references unknown token '<ref>'`

> `components.<group>.<variant>: css '<prop>' references unknown token '<ref>' — check the token path, or use a bare string / number for a raw CSS value`
> `globals element '<sel>': '<prop>' references unknown token '<ref>' — …`

A `ref("…")` (or `{ ref: "…" }`) pointed at a token that doesn't exist. **Fix the path** — e.g.
`ref("colors.link")`, `ref("typography.fontSize.lg")`. (A raw CSS value doesn't need a ref at all
— inside a `css` block a bare string is already a literal: `cursor: "pointer"`.) See the
literals-vs-references rule in **theme-foundations**.

## `references unknown breakpoint "<name>"`

> `Responsive entry … references unknown breakpoint "<name>".`
> `Responsive entry … is missing a "breakpoint" value.`

A `responsive` entry names a breakpoint not in the top-level `breakpoints` map (or omits one).
Add the breakpoint, or fix the name. Set `breakpoints` first — see **theme-foundations**.

## `references unknown variant "<name>"` / `unknown target "<name>"`

A `variant:` / `target:` in a responsive entry points at a variant that doesn't exist on that
property/recipe. Define the variant, or fix the reference. Remember a recipe's `variants` map
desugars to siblings that `variant:`/`target:` can then reach — see **recipes-and-composition**.

## `references unknown state "<name>"`

> `Responsive recipe entry … references unknown state "<name>".`

The state isn't in the **adapter's** allowed set. Use a state the adapter supports (CSS knows
`hover`/`focus`/`disabled`/…), or choose an adapter that renders it. States are adapter-owned, not
authored — see **theme-foundations** → states.

## `Unknown recipe property "<prop>" in <path>`

> `Unknown recipe property "<prop>" in <path> — expected a CSS property or a reserved key (variant, target, state, breakpoint, query, orientation, container, size).`

A declaration key that's neither a real CSS property nor a reserved recipe key — almost always a
typo: `ref:` where you meant a `variant:` swap, or `colr:` for `color:`. refract rejects it so it
can't ship as a stray literal declaration. Use the CSS property, or the reserved key you meant.

## `Recipe variant "<name>" is not defined` / `Cyclic recipe reference`

> `Recipe variant "<name>" is not defined in "<group>".`
> `Cyclic recipe reference in "<group>": <cycle>`

A recipe references a sibling that doesn't exist, or two recipes reference each other in a loop.
Fix the composition graph so references point at real, acyclic recipes.

## `produced a duplicate recipe name "<name>"`

> `Recipe variant expansion … produced a duplicate recipe name "<name>" — a desugared "<recipe>-<variant>" collides with an existing sibling recipe.`

A `variants` entry desugars to `<recipe>-<variant>`, which collides with a hand-authored sibling.
Rename the variant or the sibling recipe.

## `Appearance mode "<path>" overrides nothing` / `Unable to resolve base value`

> `Appearance mode "<path>" overrides nothing.`
> `Unable to resolve base value…`

A `modes` block redefines a field the property never had, or a property has no resolvable base
value. Give the property a real base, and make each mode redefine an existing field — see
**theme-foundations** → modes.

## General

- The message's quoted path is the location — start there, fix the *theme*, never the engine.
- If the shape itself is wrong, the `satisfies RawTheme` typecheck usually catches it before
  runtime — check the red squiggle first.
- **Validate against the real adapters.** With an MCP server connected, `validateTheme(candidate)`
  builds the edit against every configured target and returns **all** problems at once (per target) —
  it catches adapter-level rules (unknown state, naming collision) a bare core build misses. See
  **theme-authoring → Agent tools**.
