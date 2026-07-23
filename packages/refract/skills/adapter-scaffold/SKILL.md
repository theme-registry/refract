---
name: adapter-scaffold
description: Write your own refract output adapter when no shipped adapter targets your format — a standalone package or a local module in your own project, against the public defineAdapter contract. Use when you need a format refract doesn't ship (React-Native, Flutter, a bespoke JSON shape, …). Triggers: "no adapter for X", "write my own adapter", "custom output format", "defineAdapter", "React Native adapter".
tier: optional
---

# Write your own adapter

refract's adapter contract is public and stable, so if the shipped adapters (CSS, SCSS,
styled-components, JSON — see **adapter-usage**) don't target your format, you can write one **in
your own project** — a small standalone npm package or just a local module. You depend only on the
published `@theme-registry/refract`; you do **not** fork or clone the refract repo. Full contract
reference: `docs/extending.md`.

## The contract

`createTheme` calls your adapter's `bind(model, ctx)` once, then curries the returned `BoundSpec`
onto the theme. You author an `AdapterSpec<TUnit>` and wrap it with `defineAdapter`.

- **`TUnit`** — your output unit: `string` for text formats, an object type for JSON / RN / style
  objects. `recipeName` is always `string`; only `renderRecipe` / `renderVariables` / `join` are
  `TUnit`.
- **Required primitives** (the only format-specific work):
  - `recipeName(subsystem, group, variant): string` — the rule-set's identity (a class, a key).
  - `renderRecipe(subsystem, group, variant): TUnit` — one rule-set (base + state/responsive rules).
  - `renderVariables(subsystem): TUnit` — one subsystem's tokens.
  - `join(parts: TUnit[]): TUnit` — combine units.
- **`allowedStates?`** — the states your format can render (`["hover","focus",…]`); omit to accept
  any. Core validates recipe `state:` refs against it before `bind`.
- **Optional:** `renderToken`, aggregator overrides (`renderAllRecipes`/`…Variables`/`renderAll`),
  `extend(theme)` (attach runtime glue), `emit(plan?)` (build-time files — switch on `plan.type`
  and throw a clear error for modes you don't support).

`defineAdapter(spec)` supplies the default aggregators as pure Model walks — override only if the
full document isn't a flat concatenation.

## The module

```ts
import type { ThemeModel, AdapterSpec, RenderContext, ThemeAdapter } from "@theme-registry/refract";
import { defineAdapter } from "@theme-registry/refract";
// naming helpers if you need them: from "@theme-registry/refract/adapter-kit"
// OKLCH color math if you need it:  from "@theme-registry/refract/color-math"

export type MyUnit = string;                       // ← or your object type
export type MyAdapterOptions = { /* prefix?, … */ };

export const createMyAdapter = (options: MyAdapterOptions = {}): ThemeAdapter<MyUnit> =>
  defineAdapter({
    name: "my-format",
    version: 1,
    // allowedStates: ["hover", "focus", "disabled"],
    bind(model: ThemeModel, ctx: RenderContext) {
      const { media, containers, resolve } = ctx;   // resolve(ref) → value; containers = §10.5
      void options; void media; void containers;
      // Precompute per-subsystem lowering here (walk model.subsystems.<sub>.properties / .ruleSets).
      return {
        recipeName(subsystem, group, variant) { /* … */ return `${subsystem}-${group}-${variant}`; },
        renderRecipe(subsystem, group, variant) { /* … */ return "" as MyUnit; },
        renderVariables(subsystem) { /* … */ return "" as MyUnit; },
        join(parts) { return parts.join("\n\n") as MyUnit; },
      };
    },
  });
```

Use it like any adapter: `createTheme(raw, { adapter: createMyAdapter() })`.

## Packaging choices

- **Local module** — simplest: a file in your app, imported straight into your `theme.config` or a
  `createTheme` call. No publishing.
- **Standalone package** — if you want to reuse or share it: a normal npm package with
  `@theme-registry/refract` as a **peer dependency** (the consumer's single installed core is
  shared), marked `external` in your bundler so you never ship a copy of core.

## Notes

- Never import from a relative core path — always the published specifiers
  (`@theme-registry/refract`, `/adapter-kit`, `/color-math`).
- Adapters are **not** subsystems; you don't register anything on core.
- Read `docs/extending.md` for the full `ThemeModel` walk and the `emit()` file contract.

*(Contributing an adapter back into the refract monorepo itself is a different, internal workflow —
that's the repo's own `adapter-scaffold` contributor skill, not this one.)*
