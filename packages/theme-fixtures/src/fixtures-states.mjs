// States fixture — clean-room port of `test/fixtures-states.ts`. Exercises the recipe-only `state`
// condition axis end-to-end through the clean-room pipeline:
//   - a recipe variant with a grouped `states: { hover, disabled }` map;
//   - a state × breakpoint cross-product via `responsive: [{ breakpoint, state, … }]`;
//   - a component that references a recipe carrying a `hover` AND adds its own `hover` delta.
//
// One deliberate difference from the OLD fixture: an explicit empty `layout: {}` slice. The OLD
// `createTheme` emitted a default `.dt-container` UNCONDITIONALLY (even with no layout config); the
// clean-room gates the structural generators on a layout slice being present (load-bearing for the
// single-subsystem golden slice gates — an always-on container would leak into colors-only output).
// So authoring `layout: {}` is the clean-room's explicit opt-in for the default container — which
// reproduces the OLD's container block byte-for-byte, keeping `states.test.ts.snap` identical.

export const statesTheme = {
  options: {
    colors: { prefix: "app", classPrefix: "app-color" },
    effects: { prefix: "app", classPrefix: "app-fx" },
    borders: { prefix: "app", classPrefix: "app-border" },
    components: { prefix: "app", classPrefix: "app" },
  },
  rawTheme: {
    breakpoints: { sm: 576, md: 768, lg: 1024 },
    colors: {
      primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6", light: "#a5d8ff" } },
      shadow: { base: "#000000", variants: { a10: { modifiers: [{ alpha: 10 }] } } }, // translucent shadow ink (§13.3)
      recipes: {
        solid: {
          primary: {
            background: "primary",
            color: "primary.text",
            // states list → pure-state overrides (no breakpoint)
            states: [
              { state: "hover", background: "primary.dark" },
              { state: "disabled", background: "primary.light", color: "primary" },
            ],
            // state × breakpoint cross-product → `:hover` scoped inside `@media md`
            responsive: [
              { breakpoint: "md", state: "hover", background: "primary.light" },
            ],
          },
        },
      },
    },
    // Explicit opt-in for the default container (see the header note) — reproduces the OLD's
    // unconditional `.dt-container` block for byte-parity with the frozen snapshot.
    layout: {},
    effects: {
      shadow: {
        offsetY: 1, blur: 3, color: "colors.shadow.a10",
        variants: { lg: { offsetY: 10, blur: 20, color: "colors.shadow.a10" } },
      },
      recipes: {
        card: {
          // effects recipe with a plain state (no breakpoint)
          default: {
            boxShadow: "base",
            states: [{ state: "hover", boxShadow: "lg" }],
          },
        },
      },
    },
    // §14 — radius geometry moved to the `borders` subsystem. `box.default` supplies the
    // border-radius the effects `card` recipe used to; exercised standalone here.
    borders: {
      radius: { base: 6, variants: { lg: 12 } },
      recipes: {
        box: {
          default: { radius: "base" },
        },
      },
    },
    components: {
      recipes: {
        buttons: {
          // references colors solid.primary (which carries a hover) AND adds its own hover delta
          primary: {
            colors: "solid.primary",
            css: { cursor: "pointer", border: "none" },
            states: [{ state: "hover", css: { boxShadow: "0 6px 16px rgba(0,0,0,0.2)" } }],
          },
        },
      },
    },
  },
};

export const statesFixtures = { statesTheme };
