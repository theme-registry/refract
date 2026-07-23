/**
 * `ref(path)` — author a token **reference** inside a `css` delta or a globals element rule.
 *
 * Inside a `css` block (and globals element declarations) a bare string is a **literal** CSS value —
 * `display: "flex"` emits `flex`. To emit a token reference instead, wrap the token path in `ref()`:
 * `color: ref("colors.brand.text")` → `var(--…)`. The JSON-safe equivalent is the plain object form
 * `{ ref: "colors.brand.text" }`; both produce the same Model reference, so a `theme.raw.json` needs no
 * function. (Top-level recipe composition fields — `colors: "solid.brand"` — are unaffected: a bare
 * string there is always a reference.)
 */
export const ref = (path: string): { ref: string } => ({ ref: path });
