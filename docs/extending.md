# Extending refract

For developers adding a new **output adapter** (a format target) or a new **subsystem** (a
token domain). For authoring a theme, see **[authoring.md](authoring.md)**.

- [The format-neutral Model](#the-format-neutral-model)
- [The adapter contract](#the-adapter-contract)
- [`defineAdapter`](#defineadapter)
- [Worked reference: the CSS adapter](#worked-reference-the-css-adapter)
- [Format-neutrality: JSON and SCSS](#format-neutrality-json-and-scss)
- [Writing a subsystem](#writing-a-subsystem)
- [Versioning](#versioning)

## The format-neutral Model

Everything downstream lowers from one structure, `ThemeModel`. It carries **no** format
knowledge — no CSS variable names, no units, no `@media` strings. Those are the adapter's
job. The core shapes:

| Type | What it is |
| --- | --- |
| `ThemeModel` | `{ breakpoints, containers?, subsystems }` — the whole theme |
| `SubsystemModel` | one subsystem's `{ properties, ruleSets }` |
| `PropertyModel` | a token: base value + variants + responsive overrides, all as `Ref`s |
| `RuleSet` / `RuleSetGroup` | a recipe/structural rule-set: `declarations` + `overrides` (states + responsive), tagged `kind: "recipe" \| "utility" \| "reset" \| "globals"`. `"reset"` targets a `:where(selector)` normalization layer; `"globals"` a bare-selector themed element carrying delta-only `variants` |
| `Ref` | a value: `{ ref?, value?, fn?, arg?, wrap? }` — a token path, a literal, and/or a derivation |

A `Ref` is the crux of format-neutrality. `{ ref: "colors.brand", value: "#4c6ef5" }`
lets the adapter choose: emit `var(--dt-color--brand)` (CSS), `$dt-colors-brand` (SCSS),
`theme.colors.brand` (styled-components), the path string (JSON), or the baked literal
(inline). Composition references are kept **by pointer** in the Model, so a referenced
recipe's own states ride along.

Import the types from the `.` barrel:

```ts
import type {
  ThemeModel, SubsystemModel, PropertyModel, RuleSet, RuleSetGroup, Ref,
  ThemeAdapter, AdapterSpec, RenderContext,
} from "@theme-registry/refract";
```

## The adapter contract

An adapter is a `ThemeAdapter<TUnit>` — `TUnit` is the format's unit of output (`string`
for CSS/SCSS, an object for JSON/styled-components). You author an `AdapterSpec` and wrap
it with `defineAdapter`.

```ts
interface AdapterSpec<TUnit = string> {
  readonly name: string;                       // "css", "scss", "json", …
  readonly version: number;                    // external packages pin to this
  readonly allowedStates?: readonly string[];  // the states this format can render (CSS: hover, disabled, …)
  bind(model: ThemeModel, ctx: RenderContext): BoundSpec<TUnit>;
}
```

`bind` is called **once** with the Model and a `RenderContext`, and returns the render
surface already closed over both. `RenderContext` gives you:

- `media` — the core-built `breakpoints → @media` descriptor (you decorate its syntax);
- `containers` — per-named-container `@container` builders (§ container queries);
- `resolve(path)` — a token path → its concrete literal, for inline / value output.

`allowedStates` lives at the spec level (not `bind`) because recipe normalization runs
*before* `bind`; core validates `state:` refs against it with no import of your adapter.
Return it, and an unknown state name in a raw theme throws. Omit it, and any state is
accepted (as JSON does — it renders states as plain data).

### The four required primitives

`bind` returns a `BoundSpec`. Only four methods are genuinely format-specific — the rest
are defaulted:

```ts
interface BoundSpec<TUnit> {
  recipeName(subsystem: string, group: string, variant: string): string;  // the recipe's identity (a class, a key…)
  renderRecipe(subsystem: string, group: string, variant: string): TUnit; // one rule-set: base + all its state/responsive rules
  renderVariables(subsystem: string): TUnit;                              // one subsystem's tokens (its :root vars in CSS)
  join(parts: TUnit[]): TUnit;                                            // combine units (CSS: parts.join("\n\n"); JSON: merge)

  // Optional lifecycle:
  extend?(theme): Record<string, unknown>;   // attach runtime helpers to the theme (the theme.media / theme.css pattern)
  emit?(plan?): EmitOutput;                  // build-time: self-contained files (vendor your own runtime helpers)

  // Optional self-description (both feed opt-in build-time artifacts):
  describeUsage?(): UsageDescriptor;                            // machine-facing → llms.txt + manifest.json
  describePreview?(plan, files): PreviewDescriptor;             // human-facing  → preview.html

  // Optional aggregator overrides (defaults cover the common case):
  renderAllRecipes?(): TUnit;
  renderAllVariables?(): TUnit;
  renderAll?(): TUnit;
}
```

- **`recipeName`** always returns a string (a CSS class, an SCSS mixin name, a JSON key).
- **`renderRecipe`** renders one variant's full rule-set — base declarations plus every
  state and responsive override, in the format's idiom.
- **`renderVariables`** renders one subsystem's token block.
- **`join`** is the one combinator the defaulted aggregators need.
- **`extend`** attaches the runtime surface (`theme.css`, `theme.media`, `theme.classes`, …).
- **`emit`** returns self-contained build files; it receives the normalized `emit` plan
  (§ `emit` modes) and should throw a clear error for a mode it doesn't honor.
- **`describeUsage`** describes how to *consume* the output — it feeds the opt-in `guide`
  (`llms.txt` + `manifest.json`). `defineAdapter` supplies a generic default (recipe identities via
  `recipeName`), so overriding it is optional; do so to add format-specific consumption prose.
- **`describePreview`** describes how to *render* the output for a human — it feeds the opt-in
  `preview` (`preview.html`). Unlike `describeUsage` it has **no default**: an absent implementation
  means "I don't know how to show this in a browser", and the preview falls back to token plates
  only. That is the correct behavior for an adapter that has never heard of previews, which is why
  the contract stays additive.

#### Writing `describePreview`

```ts
describePreview(plan: NormalizedEmit, files: readonly string[]): PreviewDescriptor;

interface PreviewDescriptor {
  stylesheets: readonly string[];                     // emitted files a browser can load AS-IS, in load order
  markup?(recipe: UsageRecipe): { tag?, attrs } | undefined;  // how to render one recipe
  groupBy?(recipe: UsageRecipe): string | undefined;  // page layout grouping (subsystem, component file…)
  modeAttribute?: string;                             // attribute on <html> that forces a mode (CSS: "data-theme")
  unavailable?: string;                               // why a live render isn't possible (when stylesheets is empty)
  notes?: readonly string[];                          // caveats to surface even when rendering works
}
```

Three rules worth internalizing before you write one:

1. **Say nothing rather than something false.** If your format isn't loadable by a browser — Sass
   needs compiling, JS modules need a framework, JSON has no rendered form — return
   `{ stylesheets: [], unavailable: "…" }`. The preview then renders token plates and names every
   recipe, instead of showing a grid of unstyled boxes that misrepresents the theme.
2. **Never re-derive filenames from the plan.** In `subsystem` / `components` mode `filename` is a
   *user-supplied function*, so the plan alone cannot tell you what was written — that's exactly why
   `files` is an argument. (The build layer also intersects your `stylesheets` with the real
   listing, so drift degrades gracefully rather than producing a broken page; don't rely on it.)
3. **The plan can change the right answer, not just the file list.** `split` has a load-order
   contract (variables first). `components` emits merged, self-contained rules keyed by a *different*
   class than the composition list every other mode uses, and emits only the components subsystem —
   so both `markup` and which recipes are renderable differ in that mode.

### Naming overrides

The two **text** adapters (CSS + styled-components) take an optional `naming` option so a caller
can swap how class and variable names are generated without forking the adapter. Default naming is
untouched — omit `naming` and the output is byte-identical.

```ts
type NamingOverrides = {
  className?(
    address: { kind: "recipe" | "container"; subsystem: string; group: string; variant: string },
    defaults: { classToken: string; name: string },   // name = the built-in class
  ): string;
  variableName?(
    address: { path: string; segments: string[] },
    defaults: { varToken: string; name: string },      // name = the built-in var, incl. `--` prefix
  ): string;
};

createCssAdapter({ naming });                  // and createStyledComponentsAdapter({ naming })
```

Each formatter receives the **structured address** plus the **built-in default** — decorate it
(`` `${defaults.name}-rtl` ``) or replace it. Return `defaults.name` for the kinds you don't care
about. Both formatters wire into the two pure choke points (variable naming and recipe/class
naming), so a remap is applied **once** and every emission site stays consistent automatically: a
variable's `:root` definition **and** every `var(--…)` usage; a recipe's class rule, its resolved
`classList` / component-reference lookup, and `theme.classes`. `className` also covers the
`-cq-<name>` **container-context** utilities via `kind: "container"` (there `address.variant` is the
container name, and the built-in default is `<classToken>-cq-<name>`, not the recipe formula).

The adapter enforces a three-part **contract** on every result:

- **Deterministic** — a pure function of the address. The same address must always yield the same
  name (definitions and usages call the formatter repeatedly).
- **Collision-free** — the adapter tracks minted names and **throws** if two distinct addresses
  produce the same output (two classes, or two token paths, that would clash).
- **Valid identifier** — the result is run through the segment sanitizer (`variableName` is
  normalized to `--` + a sanitized body); an empty result throws.

Scope: **CSS + SC share one override path** (the shared `packages/refract/src/adapter-kit.ts`); the JSON adapter
keys its data its own way and stays out.

## `defineAdapter`

`defineAdapter(spec)` wraps your `AdapterSpec` into a `ThemeAdapter`, supplying the
default aggregators so you don't hand-write them:

- `renderAllRecipes()` → `join` over every `renderRecipe`;
- `renderAllVariables()` → `join` over every `renderVariables`;
- `renderAll()` → `join([renderAllVariables(), renderAllRecipes()])`.

Override any of the three when the format needs different assembly (JSON and CSS both do,
to place global breakpoints/keyframes). A minimal adapter:

```ts
import { defineAdapter } from "@theme-registry/refract";
import type { AdapterSpec } from "@theme-registry/refract";

const spec: AdapterSpec<string> = {
  name: "my-format",
  version: 1,
  allowedStates: ["hover", "disabled"],
  bind(model, ctx) {
    return {
      recipeName: (s, g, v) => `${s}-${g}-${v}`,
      renderRecipe: (s, g, v) => renderOne(model, ctx, s, g, v),
      renderVariables: s => renderVars(model, s),
      join: parts => parts.join("\n\n"),
    };
  },
};

export const createMyAdapter = () => defineAdapter(spec);
```

The fastest start is the **`adapter-scaffold`** skill, which generates this skeleton (the
four primitives stubbed, `defineAdapter` wrap, a test stub) against the CSS adapter as the
worked reference.

## Worked reference: the CSS adapter

`packages/refract-css/src/` is the canonical, deepest adapter — read it end to end:

- `naming.ts` — variable + class naming (the format's naming policy, owned here not in core).
- `lowering.ts` — Model rule-sets/properties → a CSS node IR (`lowerRecipeGroup`,
  `lowerMergedRuleSet`, the state → selector table, `@media` wrapping).
- `render.ts` — the node IR → CSS text (`renderVariablesCss`, `renderRulesCss`, ref
  enrichment for inline).
- `index.ts` — the `AdapterSpec`, the `extend` surface, and the `emit(plan)` switch
  (single/split/subsystem/components).

Every naming decision, the state selectors, responsive expansion, and the emit modes live
in the adapter — core hands it the neutral Model and nothing else.

## Format-neutrality: JSON and SCSS

Two more shipping adapters prove the contract isn't CSS-shaped:

- **JSON** (`packages/refract-json/src/`) — `TUnit` is an **object**, not a string. `join` merges
  fragments; the adapter overrides the aggregators to place global breakpoints/keyframes.
  It lowers the full Model to address-keyed data — the proof that `TUnit` is genuinely
  format-generic.
- **SCSS** (`packages/refract-scss/src/`) — tokens become compile-time Sass **`$variables`**;
  refs render `$dt-…`; overrides nest idiomatically (`&:hover`, nested `@media`). A
  distinct format from CSS despite both using `TUnit = string` (compile-time `$vars` vs
  runtime custom properties).

Each is its own package: `@theme-registry/refract-json`,
`@theme-registry/refract-scss` (both peer-depend on `@theme-registry/refract`).

## Writing a subsystem

A subsystem is a `Subsystem` descriptor added to the core list — pushing onto that list is
the *only* change; the pipeline is generic. The contract (`packages/refract/src/core/subsystem.ts`):

```ts
interface Subsystem {
  readonly key: string;                        // the rawTheme[key] slice + Model namespace
  normalizeProperties(rawSlice, ctx): NormalizedProperties;         // REQUIRED — raw slice → canonical properties
  interpretRecipe?(name, variant, ctx): InterpretedRecipeVariant;   // required IF the subsystem has recipes
  extractReferences?(normalizedVariantBase): string[];              // composition only (the `components` hook)
  buildStructural?(rawSlice, ctx): StructuralOutput;                // generator-driven rule-sets (layout's columns/grids/…, globals' preset + elements)
  readonly derivations?: DerivationRegistry;                        // value-derivation fns (colors: { lighten, darken })
}
```

- **`normalizeProperties`** turns your raw slice into the canonical property shape the
  Model builder consumes; you decide which sub-keys are reserved (`recipes` is skipped by
  convention).
- **`interpretRecipe`** turns one normalized recipe into declaration refs. The generic
  recipe path drives normalization, the cycle-safe resolver, and Model rule-set construction
  around it — you only interpret one recipe. `ctx` gives you `tokens`, `resolveCssVariable`,
  and lazy sibling resolution. A recipe's optional **`variants`** modifier map (§7A) is a
  reserved recipe-leaf key — alongside `states` / `responsive` — that the shared
  `normalizeRecipeGroup` **expands into flat sibling recipes before your hook runs**, so
  `interpretRecipe` only ever sees plain recipes. Nothing subsystem-specific: it works on
  every subsystem's recipes with no new hook.
- **`extractReferences`** is the composition hook: return the cross-subsystem references a
  variant names (`"colors:solid.primary"`), and the spine keeps them as Model pointers.
- **`buildStructural`** emits generator-driven rule-sets plus config tokens (how layout
  produces `columns`/`grids`/`stacks`/`container`, and how `globals` produces its `:where()`
  preset layers + `kind:"globals"` themed element rules). Its `ctx` also carries the adapter's
  `allowedStates` / `allowedContainers` so a structural rule-set can validate recipe-style
  conditions (globals element `states`) up front.
- **`derivations`** contributes value-derivation fns to the shared registry (colors adds
  `lighten`/`darken`; layout adds `scaleStep` for §10.6 numeric scale synthesis — see below).
  Duplicate fn names across subsystems throw.

`packages/refract/src/subsystems/colors/` is the fullest reference (properties, synthesized derivations,
and recipes). Adding a subsystem changes no adapter and no core control flow.

**Scale synthesis (`scaleStep`, §10.6).** `normalizeProperties` on layout can *generate* a
property's variant ramp from a `base` + a curve (geometric `ratio` / linear `step`) instead
of taking hand-listed variants — the same shape colours use for tonal steps. Each generated
rung is stored as a derived `Ref` (`{ ref: "layout.<prop>", fn: "scaleStep", arg, value, unit: "px" }`)
so `override()` of the base re-derives the whole ramp; `scaleStep` is the registry fn that
recomputes it. Files: `packages/refract/src/subsystems/layout/{normalize,index,types}.ts` (authoring surface +
the hook), `packages/refract/src/core/model/buildModel.ts`, and `packages/refract/src/core/units.ts` — the one core mechanic is
that a **derived length leaf** (a `Ref` that carries both a baked `value` *and* a `fn`) now
has its `unit` resolved through the units config just like a plain literal length. A `%`-pinned
value has no magnitude and is never synthesized. See `test/scale-synthesis.test.ts` for the
authoritative examples.

## Versioning

`AdapterSpec.version` is the contract number external adapter packages pin to. Keep the
required surface small (the four primitives) and the version stable; bump it only on a
breaking change to what `bind` receives or must return. The Model, the `RenderContext`,
and the primitive signatures are the frozen public contract — everything else about a
format lives inside the adapter.
