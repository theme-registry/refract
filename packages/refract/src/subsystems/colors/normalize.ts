/**
 * Colors' `normalizeProperty` hook — palette variant synthesis (§13).
 *
 * After the shared normalize pass, each palette colour synthesizes its variants:
 *  - **auto variants** — numeric tonal `steps` (`100…900`) when declared, else the default named
 *    set (`light` / `lighter` / `dark` / `darker`);
 *  - **derivation-spec variants** — authored `{ darken | lighten | alpha, ref? }` (§13.3), each
 *    resolved against its source (base by default, or another variant via `ref`).
 *
 * Every generated variant carries both its baked value (for the CSS lowering today) and `derive`
 * metadata (`{ ref, fn, arg }`) so the Model stores it as a derived `Ref` that re-resolves for free
 * when its source is overridden. All colour maths runs in rgb space (see `./utils`); a colour that
 * carries derivations must have a parseable rgb base (hex or `[r,g,b]`).
 */

import type {
  AdjustDials,
  HarmonyOption,
  NormalizedPaletteValue,
  PaletteDerivationSpec,
  PalettePropertyExtras,
} from "./types";
import type { NormalizedModeOverride, NormalizedVariantValue } from "../../core/normalize";
import { lighten, darken, alpha, setL, rotateHue, adjust, parseColor } from "./utils";
import { coerceColorInput } from "./colorInput";
import { RefractError } from "../../core/errors";

type PaletteVariant = NormalizedVariantValue<string, PalettePropertyExtras>;
type PaletteMode = NormalizedModeOverride<string, PalettePropertyExtras>;

/** Colors' derivation fns, by name — the same string-in/string-out fns the Model derivations use.
 *  Each takes the opaque `arg` off the derivation Ref and coerces it (a number for the lightness/
 *  hue/alpha fns; an {@link AdjustDials} object for `adjust`). */
const DERIVE_FNS: Record<string, (value: string, arg: unknown) => string> = {
  lighten: (v, a) => lighten(v, Number(a)),
  darken: (v, a) => darken(v, Number(a)),
  alpha: (v, a) => alpha(v, Number(a)),
  setL: (v, a) => setL(v, Number(a)),
  rotateHue: (v, a) => rotateHue(v, Number(a)),
  adjust: (v, a) => adjust(v, a as AdjustDials),
};

// Named-set steps are OKLCH ΔL points (§20.3). 10 keeps `lighter` a real tinted colour even on
// already-light bases (Δ20 collapsed it to pure white) while still spanning a clear ±20 L ramp
// across `lighter…darker` on mid-tone bases. Authors override per-colour via `lightenBy`/`darkenBy`.
const DEFAULT_LIGHTEN_BY = 10;
const DEFAULT_DARKEN_BY = 10;

const NAMED_LIGHTER_ORDER = ["light", "lighter"];
const NAMED_DARKER_ORDER = ["dark", "darker"];

/**
 * dec.4 — whether a derivation `ref` sources ANOTHER property (a dotted `<subsystem>.<property>…`
 * path whose property prefix differs from the owning `colors.<propertyName>`). Such a source isn't
 * available during this property's single normalize pass, so it's deferred to the post-build
 * `bakeCrossPropertyDerivations` resolve pass. A bare name or a same-property dotted path is intra.
 */
const isCrossPropertyRef = (ref: string | undefined, propertyName: string): boolean => {
  if (!ref || !ref.includes(".")) return false;
  const [seg0, seg1] = ref.split(".");
  return `${seg0}.${seg1}` !== `colors.${propertyName}`;
};

/** Whether a value is a colour this subsystem can derive from (parseable as hex or `rgb(a)`). */
const isParseableColor = (value: string): boolean => {
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
};

/** Coerce+validate one `text` colour value, re-labelling the error with its token path. */
const coerceText = (value: unknown, path: string): string => {
  try {
    return coerceColorInput(value as string);
  } catch (error) {
    throw new RefractError("REFRACT_E_COLOR_INPUT", `colors.${path}.text — ${(error as Error).message}`);
  }
};

/**
 * Coerce every `text` colour value on a normalized colour — the property itself, and any `text`
 * sibling on a literal variant or mode — to the canonical hex form (§13.1), so `text` obeys the
 * same hex/`[r,g,b]` rule as the base. Returns a structurally-shared copy (untouched fields keep
 * their references) so a colour with no `text` stays byte-identical.
 */
const coerceTextFields = (
  name: string,
  normalized: NormalizedPaletteValue,
): NormalizedPaletteValue => {
  let next = normalized;

  if (normalized.text !== undefined) {
    next = { ...next, text: coerceText(normalized.text, name) };
  }

  if (normalized.variants) {
    let changed = false;
    const variants: Record<string, PaletteVariant> = {};
    for (const [key, variant] of Object.entries(normalized.variants)) {
      if (variant.text !== undefined) {
        variants[key] = { ...variant, text: coerceText(variant.text, `${name}.variants.${key}`) };
        changed = true;
      } else {
        variants[key] = variant;
      }
    }
    if (changed) next = { ...next, variants };
  }

  if (normalized.modes) {
    let changed = false;
    const modes = normalized.modes.map(mode => {
      if (mode.text !== undefined) {
        changed = true;
        return { ...mode, text: coerceText(mode.text, `${name}.modes.${mode.mode}`) };
      }
      return mode;
    });
    if (changed) next = { ...next, modes };
  }

  return next;
};

/**
 * Merge synthesized variants (auto + derivation-spec) and baked modes into a normalized palette
 * colour. Author-declared variants win over generated ones on name collision. Returns the input
 * unchanged when nothing is produced (a plain non-derivable colour stays byte-identical).
 *
 * @param name             The colour's property name — used to build token paths (`colors.<name>.<v>`).
 * @param normalized       The colour after the shared property normalize pass (base already coerced).
 * @param derivationSpecs  Authored `{ darken|lighten|alpha, ref? }` variants, split out upstream
 *                         (core normalize can't interpret them — they have no `base`).
 */
export const finalizePaletteNormalization = (
  name: string,
  normalized0: NormalizedPaletteValue,
  derivationSpecs: Record<string, PaletteDerivationSpec> = {},
): NormalizedPaletteValue => {
  // `text` is a colour value too — run it through the same input gate as the base (core doesn't
  // coerce extras). hex / tuple / oklch() / hsl() / rgb() / keyword all normalize to canonical rgb;
  // only a var(--…) throws with a path-labelled error.
  const normalized = coerceTextFields(name, normalized0);
  const baseParseable = isParseableColor(normalized.base);
  const hasSteps = !!(normalized.steps && normalized.steps.length);
  const hasDerivations = Object.keys(derivationSpecs).length > 0;
  const hasHarmony = normalized.harmony !== undefined;

  if ((hasSteps || hasDerivations || hasHarmony) && !baseParseable) {
    throw new RefractError(
      "REFRACT_E_STEPS",
      `colors.${name} declares derived steps/variants but its base "${normalized.base}" is not a hex or [r,g,b] colour.`,
    );
  }

  const autoVariants = baseParseable ? generateAutoVariants(normalized, name) : {};
  const harmonyVariants = baseParseable ? generateHarmonyVariants(normalized, name) : {};
  const plainVariants = normalized.variants ?? {};
  const known = { ...autoVariants, ...harmonyVariants, ...plainVariants };
  const derivedVariants = bakeDerivationVariants(name, normalized.base, known, derivationSpecs);

  // Precedence: generated auto + harmony variants first, then author variants (plain + derivation) win.
  const variants = { ...autoVariants, ...harmonyVariants, ...plainVariants, ...derivedVariants };
  const bakedModes = bakeDerivedModes(normalized, name, variants);
  const bakedResponsive = bakeResponsiveDerivations(normalized, name, variants);

  if (!Object.keys(variants).length && !bakedModes && !bakedResponsive) {
    return normalized;
  }

  return {
    ...normalized,
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(bakedModes ? { modes: bakedModes } : {}),
    ...(bakedResponsive ? { responsive: bakedResponsive } : {}),
  };
};

/**
 * dec.5 — bake a colour's **responsive `ref` + `modifiers`** entries (swap-and-transform). A plain
 * `{ ref }` swap stays a var reference (untouched, handled by the CSS lowering). A `{ ref, modifiers }`
 * entry is folded here into a literal `base` override + `derive` metadata (source = the same-property
 * variant named by `ref`), exactly like a derivation-spec variant — so `override()` re-bakes it, and
 * the lowering writes the baked value (to `target`, default the base var) instead of a swap. Returns
 * `undefined` when nothing needed baking (so the property stays byte-identical).
 */
const bakeResponsiveDerivations = (
  normalized: NormalizedPaletteValue,
  propertyName: string,
  variants: Record<string, PaletteVariant>,
): NormalizedPaletteValue["responsive"] | undefined => {
  const responsive = normalized.responsive as unknown as Array<Record<string, unknown>> | undefined;
  if (!responsive || !responsive.length) return undefined;

  let changed = false;
  const out = responsive.map((entry, i) => {
    const ref = entry.ref as string | undefined;
    const rawModifiers = entry.modifiers;
    if (!ref || !Array.isArray(rawModifiers) || !rawModifiers.length) {
      // Coercion fix — a colour responsive override's literal value fields (`base` / `text`) go through
      // the same colour input gate as the property base/variants/modes (hex/tuple/keyword → canonical rgb).
      let coerced: Record<string, unknown> | undefined;
      for (const key of ["base", "text"]) {
        const v = entry[key];
        if (typeof v === "string" || Array.isArray(v)) {
          const next = coerceColorInput(v as string);
          if (next !== v) {
            coerced = coerced ?? { ...entry };
            coerced[key] = next;
          }
        }
      }
      if (coerced) changed = true;
      return coerced ?? entry;
    }

    const variant = variants[ref];
    if (!variant) {
      throw new RefractError("REFRACT_E_VARIANT_REF", `colors.${propertyName}.responsive[${i}] references unknown variant "${ref}".`);
    }
    if (variant.base === undefined) {
      throw new RefractError("REFRACT_E_VARIANT_REF", `colors.${propertyName}.responsive[${i}] references "${ref}", a cross-property derivation — not supported.`);
    }
    const modifiers = parseSpecModifiers({ modifiers: rawModifiers } as PaletteDerivationSpec, propertyName, `responsive[${i}]`);
    let value = variant.base;
    for (const mod of modifiers) value = DERIVE_FNS[mod.fn](value, mod.arg);

    changed = true;
    const { ref: _ref, modifiers: _mods, ...rest } = entry;
    return { ...rest, base: value, derive: { ref: `colors.${propertyName}.${ref}`, modifiers } };
  });

  return (changed ? out : responsive) as unknown as NormalizedPaletteValue["responsive"];
};

/**
 * Bake a palette colour's **derived** appearance modes (§10.3). Core normalize records a derived
 * mode base as `{ derive: { fn, arg } }` (no source, unbaked); colors resolves it against the
 * colour's OWN base — `value = fn(base, arg)`, `ref = colors.<name>` — exactly like a tonal step,
 * so `override()` of the base re-bakes the mode for free. Literal modes pass through untouched.
 * Returns `undefined` when the colour has no modes (so the property stays byte-identical).
 */
const bakeDerivedModes = (
  normalized: NormalizedPaletteValue,
  propertyName: string,
  variants: Record<string, PaletteVariant>,
): PaletteMode[] | undefined => {
  const modes = normalized.modes;
  if (!modes || !modes.length) return undefined;

  // dec.4 — resolve a mode derivation's SAME-PROPERTY source: the own base (default), or a variant /
  // step, addressed by bare name or by the fully-qualified `colors.<propertyName>.<name>` path.
  // A *cross-property* ref is intercepted upstream (baked post-build), so it never reaches here.
  const resolveSource = (ref: string | undefined, modeName: string): { value: string; path: string } => {
    if (!ref || ref === `colors.${propertyName}`) return { value: normalized.base, path: `colors.${propertyName}` };
    const name = ref.includes(".") ? ref.slice(`colors.${propertyName}.`.length) : ref;
    const variant = variants[name];
    if (!variant || variant.base === undefined) {
      throw new RefractError("REFRACT_E_VARIANT_REF", `colors.${propertyName}.modes.${modeName} references unknown variant "${ref}".`);
    }
    return { value: variant.base, path: `colors.${propertyName}.${name}` };
  };

  return modes.map(mode => {
    const modeName = mode.mode;
    const derive = mode.derive;
    if (!derive) return mode; // literal mode (base and/or extras) — nothing to bake.

    // dec.2 — fold the modifier chain over the resolved source (dec.4). A legacy single `{ fn, arg }`
    // derive is treated as a one-element chain.
    const modifiers = derive.modifiers ?? (derive.fn ? [{ fn: derive.fn, arg: derive.arg }] : []);

    // dec.4 — a CROSS-property source (a dotted path outside this colour) can't be resolved during
    // this property's single normalize pass. Emit the mode UNBAKED (its `base` absent, `derive`
    // carrying the dotted ref + chain); the post-build `bakeCrossPropertyDerivations` pass fills the
    // value against the full token map. `buildModeFields` tolerates a base-less derived mode.
    if (isCrossPropertyRef(derive.ref, propertyName)) {
      const { base: _base, derive: _derive, ...rest } = mode;
      return { ...rest, derive: { ref: derive.ref, modifiers } } as PaletteMode;
    }

    const source = resolveSource(derive.ref, modeName);
    let value = source.value;
    for (const mod of modifiers) {
      const fn = DERIVE_FNS[mod.fn];
      if (!fn) {
        throw new RefractError(
          "REFRACT_E_VARIANT_REF",
          `Unknown derivation fn "${mod.fn}" for appearance mode "colors.${propertyName}.modes.${modeName}".`,
        );
      }
      value = fn(value, mod.arg);
    }
    return { ...mode, base: value, derive: { ref: source.path, modifiers } };
  });
};

/** Auto variants: numeric tonal `steps` when declared, else the default named tonal set. */
const generateAutoVariants = (
  palette: NormalizedPaletteValue,
  propertyName: string,
): Record<string, PaletteVariant> => {
  if (palette.steps && palette.steps.length) {
    return generateNumericSteps(palette, propertyName);
  }
  return generateDefaultVariants(palette, propertyName);
};

/**
 * The built-in harmony schemes (§20.5) — each a list of `{ name, deg }` members, `deg` the signed
 * hue rotation off the base. Singular schemes get a real name (`complement`); symmetric pairs get
 * bare-numbered names ordered by rotation (a warm/cool label would lie — the temperature↔direction
 * mapping flips with the base hue). Tetradic reuses `complement` for its 180° member.
 */
const HARMONY_SCHEMES: Record<string, ReadonlyArray<{ name: string; deg: number }>> = {
  complement: [{ name: "complement", deg: 180 }],
  analogous: [
    { name: "analogous1", deg: -30 },
    { name: "analogous2", deg: 30 },
  ],
  "split-complement": [
    { name: "split1", deg: 150 },
    { name: "split2", deg: 210 },
  ],
  triadic: [
    { name: "triadic1", deg: 120 },
    { name: "triadic2", deg: 240 },
  ],
  tetradic: [
    { name: "tetradic1", deg: 90 },
    { name: "complement", deg: 180 },
    { name: "tetradic2", deg: 270 },
  ],
};

/**
 * Harmony variants (§20.5) — rotate the base's hue around the perceptual wheel to synthesize related
 * colours, each holding the base's lightness and chroma (only the hue turns, gamut-mapped by
 * `rotateHue`). The string form uses default member names; the object form renames them positionally
 * (`{ triadic: ["mint", "coral"] }`). Each variant is a re-derivable `{ ref, fn:"rotateHue", arg }`,
 * so `override()` of the base re-generates the set for free. Returns `{}` when no `harmony`.
 */
const generateHarmonyVariants = (
  palette: NormalizedPaletteValue,
  propertyName: string,
): Record<string, PaletteVariant> => {
  const harmony = palette.harmony as HarmonyOption | undefined;
  if (harmony === undefined) return {};

  let scheme: string;
  let renames: string[] | undefined;
  if (typeof harmony === "string") {
    scheme = harmony;
  } else if (typeof harmony === "object" && harmony !== null && !Array.isArray(harmony)) {
    const keys = Object.keys(harmony);
    if (keys.length !== 1) {
      throw new RefractError(
        "REFRACT_E_HARMONY",
        `colors.${propertyName}.harmony object form must name exactly one scheme; got [${keys.join(", ")}].`,
      );
    }
    scheme = keys[0];
    renames = (harmony as Record<string, string[]>)[scheme];
  } else {
    throw new RefractError("REFRACT_E_HARMONY", `colors.${propertyName}.harmony must be a scheme name or a { scheme: [names] } object.`);
  }

  const members = HARMONY_SCHEMES[scheme];
  if (!members) {
    throw new RefractError(
      "REFRACT_E_HARMONY",
      `colors.${propertyName}.harmony: unknown scheme "${scheme}". Use one of ${Object.keys(HARMONY_SCHEMES).join(", ")}.`,
    );
  }

  const result: Record<string, PaletteVariant> = {};
  members.forEach((member, i) => {
    const variantName = renames?.[i] ?? member.name;
    result[variantName] = {
      base: rotateHue(palette.base, member.deg),
      derive: { ref: `colors.${propertyName}`, fn: "rotateHue", arg: member.deg },
    } as PaletteVariant;
  });
  return result;
};

/** A single lighten/darken chain — each step compounds from the previous (base for the first). */
const buildChain = (
  result: Record<string, PaletteVariant>,
  palette: NormalizedPaletteValue,
  propertyName: string,
  existingVariants: Record<string, PaletteVariant>,
  chainSteps: string[],
  fn: (value: string, percent: number) => string,
  fnName: string,
  amount: number,
): void => {
  const tokenPath = (variant?: string): string =>
    variant ? `colors.${propertyName}.${variant}` : `colors.${propertyName}`;

  let prev = palette.base;
  let prevName: string | undefined; // undefined = the base token
  for (const step of chainSteps) {
    if (existingVariants[step]?.base !== undefined) {
      prev = existingVariants[step].base as string;
      prevName = step;
      continue;
    }
    const value = fn(prev, amount);
    result[step] = {
      base: value,
      derive: { ref: tokenPath(prevName), fn: fnName, arg: amount },
    } as PaletteVariant;
    prev = value;
    prevName = step;
  }
};

/** The default named tonal variants (`light`/`lighter` + `dark`/`darker`), each compounding. */
const generateDefaultVariants = (
  palette: NormalizedPaletteValue,
  propertyName: string,
): Record<string, PaletteVariant> => {
  const existingVariants = palette.variants ?? {};
  const result: Record<string, PaletteVariant> = {};

  const lightenAmount = palette.lightenBy ?? DEFAULT_LIGHTEN_BY;
  const darkenAmount = palette.darkenBy ?? DEFAULT_DARKEN_BY;

  buildChain(result, palette, propertyName, existingVariants, NAMED_LIGHTER_ORDER, lighten, "lighten", lightenAmount);
  buildChain(result, palette, propertyName, existingVariants, NAMED_DARKER_ORDER, darken, "darken", darkenAmount);

  return result;
};

/**
 * Map a numeric ladder label to an absolute OKLCH lightness (§20.2): `L = (1000 − label) / 10`, so
 * low labels are light and high labels dark. `0` / `1000` are reserved for pure white / black; every
 * other label clamps to `[5, 98]` so a mid-ladder rung never collapses to pure white or black.
 */
const labelToL = (label: number): number => {
  if (label <= 0) return 100;
  if (label >= 1000) return 0;
  return Math.min(98, Math.max(5, (1000 - label) / 10));
};

/**
 * Numeric tonal steps — an **absolute** OKLCH lightness ladder (§20.2). Each Tailwind-style label
 * maps to a fixed lightness via {@link labelToL}; the rung holds the base's hue and chroma (chroma
 * gamut-mapped) and sets that lightness, recorded as `{ ref, fn: "setL", arg: L }` so `override()`
 * of the base re-bakes the whole ladder for free. Because the lightness is absolute, the same label
 * reads at the same lightness across every palette. The exact authored colour stays at the
 * unnumbered `colors.<name>` token — a rung is never aliased to it, and `lightenBy`/`darkenBy` do
 * not apply. An author-declared variant of the same name wins over the generated rung. Throws on a
 * non-numeric or out-of-range (`0–1000`) label.
 */
const generateNumericSteps = (
  palette: NormalizedPaletteValue,
  propertyName: string,
): Record<string, PaletteVariant> => {
  const steps = palette.steps ?? [];
  const bad = steps.find(s => typeof s !== "number" || isNaN(s) || s < 0 || s > 1000);
  if (bad !== undefined) {
    throw new RefractError(
      "REFRACT_E_STEPS",
      `colors.${propertyName}.steps must be numbers in 0–1000 (e.g. [50, …, 950]); got ${JSON.stringify(bad)}.`,
    );
  }

  const existingVariants = palette.variants ?? {};
  const result: Record<string, PaletteVariant> = {};

  for (const step of steps) {
    const label = step.toString();
    if (existingVariants[label]) continue; // an author-declared variant wins over the generated rung.
    const L = labelToL(step);
    result[label] = {
      base: setL(palette.base, L),
      derive: { ref: `colors.${propertyName}`, fn: "setL", arg: L },
    } as PaletteVariant;
  }

  return result;
};

/**
 * Validate + normalize an `adjust` dial set (§20.4). All dials optional and numeric: `l` absolute
 * lightness `0–100`; `c` a non-negative chroma multiplier; `h` a signed hue rotation. Returns a
 * clean `{ l?, c?, h? }` (dropping `undefined`s) so the stored `arg` is minimal.
 */
const parseAdjust = (raw: unknown, propertyName: string, variantName: string): AdjustDials => {
  const at = `colors.${propertyName}.variants.${variantName}.adjust`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RefractError("REFRACT_E_ADJUST", `${at} must be an object with numeric l / c / h dials.`);
  }
  const { l, c, h } = raw as Record<string, unknown>;
  const dials: AdjustDials = {};
  if (l !== undefined) {
    if (typeof l !== "number" || isNaN(l) || l < 0 || l > 100) {
      throw new RefractError("REFRACT_E_ADJUST", `${at}.l must be an absolute OKLCH lightness in 0–100; got ${JSON.stringify(l)}.`);
    }
    dials.l = l;
  }
  if (c !== undefined) {
    if (typeof c !== "number" || isNaN(c) || c < 0) {
      throw new RefractError("REFRACT_E_ADJUST", `${at}.c must be a non-negative chroma multiplier (1 keeps, 0 greys); got ${JSON.stringify(c)}.`);
    }
    dials.c = c;
  }
  if (h !== undefined) {
    if (typeof h !== "number" || isNaN(h)) {
      throw new RefractError("REFRACT_E_ADJUST", `${at}.h must be a numeric hue rotation in degrees; got ${JSON.stringify(h)}.`);
    }
    dials.h = h;
  }
  return dials;
};

/**
 * dec.2 — parse a spec's `modifiers` chain into canonical `{ fn, arg }[]`. Each dial is a single-key
 * object (`{ darken: 10 }` → `{ fn: "darken", arg: 10 }`); `adjust` validates its dial object, the
 * scalar fns coerce to a number. An unknown fn is rejected against the colour-math registry.
 */
const parseSpecModifiers = (
  spec: PaletteDerivationSpec,
  propertyName: string,
  variantName: string,
): Array<{ fn: string; arg: unknown }> => {
  const at = `colors.${propertyName}.variants.${variantName}`;
  const modifiers = spec.modifiers;
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    throw new RefractError("REFRACT_E_VARIANT", `${at} needs a non-empty "modifiers" array (e.g. [{ darken: 10 }]).`);
  }
  return modifiers.map((m, i) => {
    if (typeof m !== "object" || m === null || Array.isArray(m)) {
      throw new RefractError("REFRACT_E_VARIANT", `${at}.modifiers[${i}] must be a single-key object like { darken: 10 }.`);
    }
    const keys = Object.keys(m as Record<string, unknown>);
    if (keys.length !== 1) {
      throw new RefractError("REFRACT_E_VARIANT", `${at}.modifiers[${i}] must have exactly one fn key; got [${keys.join(", ")}].`);
    }
    const fn = keys[0];
    if (!DERIVE_FNS[fn]) {
      throw new RefractError("REFRACT_E_VARIANT", `${at}.modifiers[${i}] unknown fn "${fn}"; use ${Object.keys(DERIVE_FNS).join(" / ")}.`);
    }
    const raw = (m as Record<string, unknown>)[fn];
    const arg = fn === "adjust" ? parseAdjust(raw, propertyName, variantName) : Number(raw);
    return { fn, arg };
  });
};

/**
 * Bake authored derivation-spec variants (§13.3). Each resolves its source (`ref` → another
 * variant/step, or the base by default), applies the colour fn, and records `{ ref, fn, arg }`.
 * Specs may reference each other (a chain); resolution is lazy with cycle detection.
 */
const bakeDerivationVariants = (
  propertyName: string,
  base: string,
  known: Record<string, PaletteVariant>,
  specs: Record<string, PaletteDerivationSpec>,
): Record<string, PaletteVariant> => {
  const result: Record<string, PaletteVariant> = {};
  const baking = new Set<string>();

  // A same-property source must have a baked base value; a cross-property-deferred variant (no base)
  // can't be a chain source in this single pass — surface that as a clear error rather than `undefined`.
  const baseOf = (variant: PaletteVariant, ref: string): string => {
    if (variant.base === undefined) {
      throw new RefractError(
        "REFRACT_E_VARIANT_REF",
        `colors.${propertyName} variant chains off "${ref}", which is a cross-property derivation — not supported.`,
      );
    }
    return variant.base;
  };
  const sourceOf = (ref: string | undefined): { value: string; path: string } => {
    if (!ref) return { value: base, path: `colors.${propertyName}` };
    if (result[ref]) return { value: baseOf(result[ref], ref), path: `colors.${propertyName}.${ref}` };
    if (known[ref]) return { value: baseOf(known[ref], ref), path: `colors.${propertyName}.${ref}` };
    if (specs[ref]) {
      bakeOne(ref, specs[ref]);
      return { value: baseOf(result[ref] as PaletteVariant, ref), path: `colors.${propertyName}.${ref}` };
    }
    throw new RefractError("REFRACT_E_VARIANT_REF", `colors.${propertyName} variant references unknown source "${ref}".`);
  };

  function bakeOne(variantName: string, spec: PaletteDerivationSpec): void {
    if (result[variantName]) return;
    if (baking.has(variantName)) {
      throw new RefractError("REFRACT_E_CYCLE", `Cyclic colour variant derivation at colors.${propertyName}.${variantName}.`);
    }
    baking.add(variantName);
    const modifiers = parseSpecModifiers(spec, propertyName, variantName);
    // dec.4 — a CROSS-property source is deferred: emit UNBAKED (no `base`), carrying the dotted ref
    // + chain. The post-build `bakeCrossPropertyDerivations` pass fills the value; `buildPropertyModel`
    // tolerates a base-less variant that carries a `derive.ref`.
    if (isCrossPropertyRef(spec.ref, propertyName)) {
      result[variantName] = { derive: { ref: spec.ref as string, modifiers } } as PaletteVariant;
      baking.delete(variantName);
      return;
    }
    const source = sourceOf(spec.ref);
    // dec.2 — fold the chain over the resolved source, in author order.
    let value = source.value;
    for (const m of modifiers) value = DERIVE_FNS[m.fn](value, m.arg);
    result[variantName] = { base: value, derive: { ref: source.path, modifiers } } as PaletteVariant;
    baking.delete(variantName);
  }

  for (const [variantName, spec] of Object.entries(specs)) bakeOne(variantName, spec);
  return result;
};
