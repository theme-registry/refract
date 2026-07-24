/**
 * Stable, machine-readable error codes (§P2-3). Every error refract throws for a theme authoring /
 * build problem — everything reachable from {@link createTheme} (subsystem normalization, token
 * derivation, DTCG parsing) — is a {@link RefractError} carrying a `code` from {@link RefractErrorCode}:
 * a stable identifier an agent (or a catch block) can branch on without string-matching the human
 * message. The message text stays human-first and unchanged; the code is additive.
 *
 * Scope: authoring/build errors. Pure CLI-tooling failures in `src/build/*` (bad arguments, a missing
 * file, an unknown command) stay plain `Error`s — they're usage errors from `refract <cmd>`, not a
 * problem with the theme an agent is editing. The one build-layer exception is `REFRACT_E_RAW_SHAPE`:
 * a value handed to `diff` / `validate` (or the MCP server) where a `RawTheme` is required but the
 * value isn't theme-shaped — that IS a theme problem, and a governance tool must fail loud + coded on
 * it (see {@link assertRawTheme}) rather than emit a nonsense "everything removed" diff at exit 0.
 *
 * Dependency-free leaf on purpose, so any module (including the standalone `adapter-kit`) can throw one
 * without pulling in the core graph.
 */
export type RefractErrorCode =
  | "REFRACT_E_COLOR_INPUT" // a colour value wasn't a derivable colour
  | "REFRACT_E_COLOR_TUPLE" // an [r,g,b] tuple was malformed
  | "REFRACT_E_STEPS" // colors.<name>.steps out of range / non-numeric
  | "REFRACT_E_VARIANT" // a derivation-spec variant / modifier chain was malformed
  | "REFRACT_E_VARIANT_REF" // a variant referenced an unknown source
  | "REFRACT_E_CYCLE" // a cyclic reference (colour variant, token, recipe, DTCG alias)
  | "REFRACT_E_ADJUST" // an adjust dial was out of range
  | "REFRACT_E_HARMONY" // an invalid harmony scheme
  | "REFRACT_E_VALIDATION" // aggregate: one or more post-build ref-validation failures (see `failures`)
  | "REFRACT_E_RECIPE_PROPERTY" // a recipe declaration key is neither a known CSS property nor a reserved key
  | "REFRACT_E_TOKEN_PATH" // a token path is unknown / malformed / uses an unknown derivation fn
  | "REFRACT_E_BREAKPOINT" // a responsive entry omitted or named an unknown breakpoint
  | "REFRACT_E_STATE" // a recipe state entry named a state the adapter doesn't know
  | "REFRACT_E_CONTAINER" // a container-query entry named an unknown container / size / unsupported axis
  | "REFRACT_E_RESPONSIVE" // a responsive/mode override was malformed (variant+target conflict, unknown ref)
  | "REFRACT_E_MEDIA" // an invalid media / container query range (min > max)
  | "REFRACT_E_MODE" // an appearance-mode override with no base to override
  | "REFRACT_E_PRESET" // an unknown globals preset name
  | "REFRACT_E_EFFECTS" // a malformed effects value (shadow / transition layer)
  | "REFRACT_E_LAYOUT" // a malformed layout scale (ratio+step, bad rung)
  | "REFRACT_E_UNITS" // a malformed units config
  | "REFRACT_E_PROPERTY" // a property couldn't be normalized (no resolvable base value)
  | "REFRACT_E_REFERENCE" // a composition / rule-set reference didn't resolve
  | "REFRACT_E_NAMING" // a naming override / default path produced a collision
  | "REFRACT_E_DTCG_VERSION" // an unreadable DTCG refract-extension version
  | "REFRACT_E_AUDIT" // a strict contrast audit failed
  | "REFRACT_E_RAW_SHAPE"; // a value passed where a RawTheme is required isn't theme-shaped (e.g. a defineConfig, an array, null)

/**
 * An authoring / build error with a stable {@link RefractErrorCode}. For an aggregate (collect-all)
 * error, `failures` lists each individual message so a caller can report them all at once.
 */
export class RefractError extends Error {
  readonly code: RefractErrorCode;
  readonly failures?: readonly string[];

  constructor(code: RefractErrorCode, message: string, failures?: readonly string[]) {
    super(message);
    this.name = "RefractError";
    this.code = code;
    if (failures) this.failures = failures;
    // Keep `instanceof RefractError` working after transpilation to ES5-ish targets.
    Object.setPrototypeOf(this, RefractError.prototype);
  }
}
