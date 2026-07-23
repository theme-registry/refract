/**
 * refract MCP — the PURE tool functions (no transport, no I/O, fully unit-testable). The query tools
 * operate on an already-built `Theme` (the server builds the project's theme once and holds it), so an
 * agent asks about *the project's* theme without resending it.
 *
 * `getClass` and `validateTheme` answer against the project's **real** adapters (the ones its
 * `theme.config` targets), not a noop stand-in — so class names carry the configured prefix and
 * validation catches every adapter-level rule (unknown state, naming collision, emit-mode conflict),
 * exactly as `refract build` would. `validateTheme` surfaces refract's **collect-all** errors so an
 * agent fixes every problem in one pass before writing, and reports them per target.
 */
import type { RawTheme, Theme, RefractError, Ref } from "@theme-registry/refract";
import { audit } from "@theme-registry/refract";

/** A theme with the CSS-style token-var accessor (duck-typed — present on the CSS adapter). */
type VarNamingTheme = Theme & { varName?: (path: string) => string | undefined };

/** Describe what a token derives from, read straight off the stored `Ref` graph (the `derivedFrom`). */
const describeDerivation = (ref: Ref | undefined): string | undefined => {
  if (!ref || ref.ref === undefined) return undefined; // terminal literal / external → nothing to derive
  const arg = (a: unknown): string => (a === undefined ? "" : `(${JSON.stringify(a)})`);
  if (ref.modifiers?.length) return `${ref.ref} ${ref.modifiers.map((m) => `${m.fn}${arg(m.arg)}`).join(" → ")}`;
  if (ref.fn) return `${ref.ref} ${ref.fn}${arg(ref.arg)}`;
  return ref.ref; // a plain alias
};

/**
 * Resolve one token path — enriched. Beyond the concrete `value`, returns the emitted CSS `varName`
 * (from a class-emitting target, carrying its configured prefix — the most useful thing to hand an
 * agent), the length `unit`, and `derivedFrom` (read off the stored `{ ref, fn/modifiers }` graph). A
 * resolved literal is frozen; the varName is the live, re-themeable handle.
 */
export const resolveToken = (
  base: Theme,
  path: string,
  targets: NamedTheme[] = [],
): { path: string; value: string; varName?: string; unit?: string; derivedFrom?: string } => {
  const value = String(base.resolveToken(path));
  const ref = base.tokens[path];
  const varName = targets.map((t) => t.theme as VarNamingTheme).find((t) => t.varName)?.varName?.(path);
  const derivedFrom = describeDerivation(ref);
  return {
    path,
    value,
    ...(varName ? { varName } : {}),
    ...(ref?.unit ? { unit: ref.unit } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
  };
};

/** Every token path in the theme — the agent's addressable vocabulary. */
export const listTokens = (theme: Theme): string[] => Object.keys(theme.tokens);

/** Token paths starting with `prefix` — so an agent can discover names (`findToken("colors.brand")`). */
export const findToken = (theme: Theme, prefix: string): string[] =>
  Object.keys(theme.tokens).filter((p) => p.startsWith(prefix));

/** Fuzzy token discovery: match `query` against a token's path OR its resolved value (case-insensitive). */
export const searchTokens = (theme: Theme, query: string): Array<{ path: string; value: string }> => {
  const q = query.toLowerCase();
  const out: Array<{ path: string; value: string }> = [];
  for (const path of Object.keys(theme.tokens)) {
    let value = "";
    try {
      value = String(theme.resolveToken(path));
    } catch {
      /* leave value empty */
    }
    if (path.toLowerCase().includes(q) || value.toLowerCase().includes(q)) out.push({ path, value });
  }
  return out;
};

export interface RecipeId {
  subsystem: string;
  group: string;
  variant: string;
}

/** Every recipe the theme defines, as `{ subsystem, group, variant }` identities. */
export const listRecipes = (theme: Theme): RecipeId[] => {
  const out: RecipeId[] = [];
  for (const [subsystem, sub] of Object.entries(theme.model.subsystems)) {
    for (const [group, ruleSetGroup] of Object.entries(sub.ruleSets ?? {})) {
      for (const variant of Object.keys(ruleSetGroup)) out.push({ subsystem, group, variant });
    }
  }
  return out;
};

/** A recipe's class name in a built theme: the plain string, or a component's `{ className, classList }`. */
type ClassLeaf = string | { className: string; classList: string[] };
type ThemeClasses = Record<string, Record<string, Record<string, ClassLeaf>>>;
/** A built theme paired with the name of the target that produced it. */
export interface NamedTheme {
  name: string;
  theme: Theme;
}
const classesOf = (theme: Theme): ThemeClasses | undefined =>
  (theme as { classes?: ThemeClasses }).classes;

/**
 * The class (and full composed class-list) an agent should put on an element for a recipe — read from a
 * target's **real** emitted classes, so the prefix/composition match what ships. Only class-emitting
 * adapters (e.g. CSS) expose `.classes`; if the project configures none, this says so rather than
 * inventing a canonical `dt-…` name that exists in no stylesheet.
 */
export const getClass = (
  targets: NamedTheme[],
  id: RecipeId,
): { className: string; classList: string[]; target: string } => {
  const named = targets.find((t) => classesOf(t.theme));
  if (!named) {
    const names = targets.map((t) => t.name).join(", ") || "(no targets configured)";
    throw new Error(
      `getClass needs an adapter that emits class names (e.g. the CSS adapter) — none of [${names}] does`,
    );
  }
  const leaf = classesOf(named.theme)![id.subsystem]?.[id.group]?.[id.variant];
  if (leaf === undefined) {
    throw new Error(`no recipe "${id.subsystem}.${id.group}.${id.variant}" — call listRecipes to see what exists`);
  }
  return typeof leaf === "string"
    ? { className: leaf, classList: [leaf], target: named.name }
    : { className: leaf.className, classList: leaf.classList, target: named.name };
};

/** The exact CSS one recipe emits — from a class-emitting target. Throws when nothing emits CSS. */
export const renderRecipe = (targets: NamedTheme[], id: RecipeId): { css: string; target: string } => {
  const named = targets.find((t) => typeof (t.theme as { renderRecipe?: unknown }).renderRecipe === "function");
  if (!named) {
    const names = targets.map((t) => t.name).join(", ") || "(no targets configured)";
    throw new Error(`renderRecipe needs an adapter that emits CSS (e.g. the CSS adapter) — none of [${names}] does`);
  }
  const render = (named.theme as unknown as { renderRecipe: (s: string, g: string, v: string) => string }).renderRecipe;
  const css = render(id.subsystem, id.group, id.variant);
  if (!css) throw new Error(`no recipe "${id.subsystem}.${id.group}.${id.variant}" — call listRecipes to see what exists`);
  return { css, target: named.name };
};

/** WCAG-2 contrast audit of the theme's colour pairings (+ advisory APCA) — `audit()` over MCP. */
export const checkContrast = (
  theme: Theme,
  minWcag?: string,
): { ok: boolean; summary: ReturnType<typeof audit>["summary"]; pairings: ReturnType<typeof audit>["pairings"] } => {
  const result = audit(theme, minWcag ? { minWcag: minWcag as never } : {});
  return { ok: result.ok, summary: result.summary, pairings: result.pairings };
};

/** One target's verdict on a candidate theme. */
export interface TargetValidation {
  target: string;
  ok: boolean;
  /** The RefractError code when invalid (e.g. `REFRACT_E_VALIDATION`, `REFRACT_E_COLOR_INPUT`). */
  code?: string;
  /** Every problem this target found — collect-all, so an agent fixes them all at once. */
  errors: string[];
}

export interface ValidateResult {
  /** True only when every target accepts the theme. */
  ok: boolean;
  perTarget: TargetValidation[];
}

/** Builds a candidate raw theme against one target's real adapter; throws exactly as `refract build` does. */
export interface Builder {
  name: string;
  build: (raw: RawTheme) => void;
}

/**
 * Validate a raw theme against every configured target, returning ALL problems per target (refract
 * collects them) rather than the first. This is the anti-drift guardrail: an agent validates a
 * candidate edit here — against the same adapters that will emit it — before it writes.
 */
export const validateTheme = (raw: RawTheme, builders: Builder[]): ValidateResult => {
  const perTarget = builders.map(({ name, build }): TargetValidation => {
    try {
      build(raw);
      return { target: name, ok: true, errors: [] };
    } catch (e) {
      const err = e as RefractError;
      return {
        target: name,
        ok: false,
        code: err.code,
        errors: err.failures ? [...err.failures] : [err.message ?? String(e)],
      };
    }
  });
  return { ok: perTarget.every((t) => t.ok), perTarget };
};
