---
name: consuming-the-output
description: Wire a built refract theme into an app (per adapter), and publish a theme so others can consume it. Use after a theme is built, when integrating it into React/CSS/Sass or shipping it as a package or artifact. Triggers: "use the theme in my app", "ThemeProvider", "import theme.css", "runtime theme switching", "publish the theme", "consume the built output".
tier: core
---

# Consuming the output

How the *output* is used differs by adapter — different format, different integration. The theme
you built (runtime `createTheme(...)` or `refract build`) exposes the shapes below.

## CSS

The emitted `.css` is self-contained — no refract at runtime.

- Import the stylesheet once (`import "./dist/theme/theme.css"`), then use the recipe **class
  names** on elements. Look them up with `theme.getClass(subsystem, group, recipe)` or the
  `theme.classes` map at build time.
- Values are `var(--…)` custom properties, so **runtime theming = swap `:root`**: override the
  variables under a selector/attribute and everything rebinds with no re-render.
- Container-query utilities emit as `.<prefix>-cq-<name>` classes.

## styled-components

The SC adapter emits **TS/JS modules**, not a stylesheet.

- Wrap the app once: `<ThemeProvider theme={theme.theme}>`. This supplies token *values*; it's set
  once and never swapped (dark rides `scheme`, not a provider swap).
- Recipes are tree-shakeable `css` blocks that read the theme
  (`${({ theme }) => theme.colors.primary}`): `styled.button\`${componentsButtonsPrimary}\``, or
  import the grouped `recipes` barrel.
- `GlobalStyle` (from the globals `preset` + element rules) mounts once.
- `theme.media.<bp>.{min,max}` and `theme.scheme.dark` are tagged-template helpers for responsive
  and dark blocks inside a recipe.
- `theme.d.ts` (ts only) augments `DefaultTheme`, so `props.theme.*` is typed.

## SCSS / JSON

- **SCSS** — `@use` the emitted partials; consume the `$variables` and mixins in your Sass build.
- **JSON** — `theme.json` is the whole model as data (tokens + rule-sets + refs); feed it to
  tooling or a non-CSS renderer.

## Publishing a theme others consume

A built theme is just files under `outDir`, so it ships as an **npm package**, a **zip / CI
artifact**, or a **vendored folder** — the downstream consumer needs neither refract nor these
skills. Ship the emitted files plus, ideally, a machine-readable token export
(`refract tokens` → `tokens.json`, see **dtcg-import**) and a short README pointing at the entry
files.

For AI-assisted consumers, refract can emit a **self-documenting guide** into `outDir` (an
`llms.txt` describing this theme's real class names / exports / token paths, plus a
`manifest.json`) so a downstream agent can consume the theme from the folder alone — enable it on
the build target (see **build-config**). Because the guide sits in `outDir`, it travels with any
distribution form, package specifier or not.

Its human-facing sibling is `preview: true`, which writes a `preview.html` specimen into the same
folder — token plates for any adapter, plus live recipe plates when the output is browser-loadable
(CSS). Reach for it when a person needs to *see* the theme (design review, a handoff, a sanity check
after a retune) rather than consume it.

While *authoring* against a live project, the **`@theme-registry/refract-mcp`** server exposes the
same information as **live tools + resources** (schema 1) — `getClass` / `resolveToken` / `renderRecipe`
and a `refract://manifest.json` resource — answering against the real compiled theme. Prefer it when
connected; the emitted `manifest.json` / `llms.txt` are the offline fallback that ships with the theme.
The tools, the emitted guide, and the refract skills all speak the same contract. See **theme-authoring
→ Agent tools**.
