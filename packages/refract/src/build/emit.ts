/**
 * `resolveEmitPlan` — normalize the authored `Emit` directive into a discriminated `NormalizedEmit`
 * with every default filled (§9, 9a). This is the build layer's light normalization; the *vocabulary*
 * (`Emit`/`NormalizedEmit`) lives in core (`src/core/ThemeAdapter.ts`), and each adapter decides which
 * modes it actually honors — `resolveEmitPlan` never renders anything.
 *
 * Discriminator inference (only `single`/`split` may omit `type`):
 *  - `undefined` / `{}` / `{ file }`        → `single`   (`file` renames the one file; default theme.css)
 *  - the `variables` key present            → `split`    (that key is what tips `{ file, variables }` in)
 *  - `subsystem` / `components`             → require an explicit `type` (or the string shorthand)
 *
 * Per-type filename/name defaults:
 *  - single    → `theme.css`
 *  - split     → `styles.css` + `variables.css`
 *  - subsystem → `<sub>.css` / `<sub>.variables.css`
 *  - components→ `${group}-${variant}.css`, `inline: true`, `variables` on (a filename)
 */
import type { Emit, NormalizedEmit } from "../core/ThemeAdapter";

const DEFAULT_SINGLE_FILE = "theme.css";
const DEFAULT_SPLIT_STYLES = "styles.css";
const DEFAULT_SPLIT_VARIABLES = "variables.css";
const DEFAULT_SUBSYSTEM_FILENAME = (subsystem: string, kind: "styles" | "variables"): string =>
  kind === "variables" ? `${subsystem}.variables.css` : `${subsystem}.css`;
const DEFAULT_COMPONENTS_FILENAME = (c: { group: string; variant: string }): string =>
  `${c.group}-${c.variant}.css`;
const DEFAULT_COMPONENTS_VARIABLES = "variables.css";

/** Normalize an authored {@link Emit} directive into a fully-defaulted {@link NormalizedEmit}. */
export function resolveEmitPlan(emit: Emit): NormalizedEmit {
  // String shorthands.
  if (emit === undefined) return { type: "single", file: DEFAULT_SINGLE_FILE };
  if (typeof emit === "string") {
    switch (emit) {
      case "single":
        return { type: "single", file: DEFAULT_SINGLE_FILE };
      case "split":
        return {
          type: "split",
          file: DEFAULT_SPLIT_STYLES,
          variables: DEFAULT_SPLIT_VARIABLES,
        };
      case "subsystem":
        return { type: "subsystem", filename: DEFAULT_SUBSYSTEM_FILENAME };
      case "components":
        return {
          type: "components",
          inline: true,
          filename: DEFAULT_COMPONENTS_FILENAME,
          variables: DEFAULT_COMPONENTS_VARIABLES,
        };
    }
  }

  // Object forms. Infer the discriminator when omitted: `variables` key ⇒ split, else single.
  const type = emit.type ?? ("variables" in emit ? "split" : "single");

  switch (type) {
    case "single": {
      const o = emit as { type?: "single"; file?: string };
      return { type: "single", file: o.file ?? DEFAULT_SINGLE_FILE };
    }
    case "split": {
      const o = emit as { type?: "split"; file?: string; variables?: string };
      return {
        type: "split",
        file: o.file ?? DEFAULT_SPLIT_STYLES,
        variables: o.variables ?? DEFAULT_SPLIT_VARIABLES,
      };
    }
    case "subsystem": {
      const o = emit as {
        type: "subsystem";
        filename?: (subsystem: string, kind: "styles" | "variables") => string;
      };
      return { type: "subsystem", filename: o.filename ?? DEFAULT_SUBSYSTEM_FILENAME };
    }
    case "components": {
      const o = emit as {
        type: "components";
        inline?: boolean;
        filename?: (c: { group: string; variant: string }) => string;
        variables?: string | false;
      };
      return {
        type: "components",
        inline: o.inline ?? true,
        filename: o.filename ?? DEFAULT_COMPONENTS_FILENAME,
        variables: o.variables ?? DEFAULT_COMPONENTS_VARIABLES,
      };
    }
  }

  // Unreachable — the union is exhausted above; keeps the compiler's return-path check happy.
  throw new Error(`resolveEmitPlan: unrecognized emit directive.`);
}
