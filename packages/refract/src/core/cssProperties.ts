/**
 * The set of known CSS property names, in kebab-case — the allow-list behind refract's fail-loud
 * recipe check. A recipe declaration whose key isn't a reserved recipe key (`variant`/`target`/…) and
 * isn't a known CSS property is almost always a typo (`ref:` for a variant swap, `colr:` for `color`)
 * that would otherwise pass through as literal CSS and ship silently. Rejecting it at build time turns
 * that class of mistake into an error — and the same predicate lets the docs pipeline reject an emitted
 * declaration whose property is not real CSS.
 *
 * Compact on purpose (a space-delimited string, split once) because this list rides in the runtime
 * `createTheme` path and counts toward the core size budget. Coverage is generous — standard properties
 * plus common logical/flex/grid/scroll/font families — so legitimate authoring never trips it. Custom
 * properties (`--*`) and vendor-prefixed names (`-webkit-…`) are accepted structurally by
 * {@link isKnownCssProperty}, so they need not appear here.
 */
const CSS_PROPERTY_NAMES =
  // layout / box model
  "display position top right bottom left inset inset-block inset-block-start inset-block-end " +
  "inset-inline inset-inline-start inset-inline-end float clear z-index visibility overflow overflow-x " +
  "overflow-y overflow-block overflow-inline overflow-clip-margin overflow-anchor box-sizing " +
  "width height min-width min-height max-width max-height block-size inline-size min-block-size " +
  "min-inline-size max-block-size max-inline-size aspect-ratio " +
  "margin margin-top margin-right margin-bottom margin-left margin-block margin-block-start " +
  "margin-block-end margin-inline margin-inline-start margin-inline-end margin-trim " +
  "padding padding-top padding-right padding-bottom padding-left padding-block padding-block-start " +
  "padding-block-end padding-inline padding-inline-start padding-inline-end " +
  // flexbox / grid
  "flex flex-grow flex-shrink flex-basis flex-direction flex-flow flex-wrap order " +
  "justify-content justify-items justify-self align-content align-items align-self place-content " +
  "place-items place-self gap row-gap column-gap grid grid-area grid-template grid-template-areas " +
  "grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows grid-auto-flow " +
  "grid-column grid-column-start grid-column-end grid-row grid-row-start grid-row-end " +
  "columns column-count column-width column-gap column-rule column-rule-color column-rule-style " +
  "column-rule-width column-span column-fill " +
  // color / background
  "color opacity accent-color caret-color color-scheme forced-color-adjust print-color-adjust " +
  "background background-color background-image background-position background-position-x " +
  "background-position-y background-size background-repeat background-origin background-clip " +
  "background-attachment background-blend-mode mix-blend-mode isolation " +
  // border / outline
  "border border-width border-style border-color border-top border-top-width border-top-style " +
  "border-top-color border-right border-right-width border-right-style border-right-color " +
  "border-bottom border-bottom-width border-bottom-style border-bottom-color border-left " +
  "border-left-width border-left-style border-left-color border-block border-block-width " +
  "border-block-style border-block-color border-block-start border-block-start-width " +
  "border-block-start-style border-block-start-color border-block-end border-block-end-width " +
  "border-block-end-style border-block-end-color border-inline border-inline-width " +
  "border-inline-style border-inline-color border-inline-start border-inline-start-width " +
  "border-inline-start-style border-inline-start-color border-inline-end border-inline-end-width " +
  "border-inline-end-style border-inline-end-color border-radius border-top-left-radius " +
  "border-top-right-radius border-bottom-right-radius border-bottom-left-radius " +
  "border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius " +
  "border-image border-image-source border-image-slice border-image-width border-image-outset " +
  "border-image-repeat border-collapse border-spacing " +
  "outline outline-width outline-style outline-color outline-offset " +
  // effects
  "box-shadow filter backdrop-filter clip-path mask mask-image mask-mode mask-repeat mask-position " +
  "mask-clip mask-origin mask-size mask-composite mask-type opacity transform transform-origin " +
  "transform-box transform-style perspective perspective-origin backface-visibility rotate scale " +
  "translate " +
  // transitions / animation
  "transition transition-property transition-duration transition-timing-function transition-delay " +
  "transition-behavior animation animation-name animation-duration animation-timing-function " +
  "animation-delay animation-iteration-count animation-direction animation-fill-mode " +
  "animation-play-state animation-composition animation-timeline will-change " +
  // typography
  "font font-family font-size font-size-adjust font-weight font-style font-variant " +
  "font-variant-caps font-variant-numeric font-variant-ligatures font-variant-east-asian " +
  "font-variant-alternates font-variant-position font-feature-settings font-variation-settings " +
  "font-kerning font-stretch font-optical-sizing font-synthesis font-display line-height " +
  "letter-spacing word-spacing text-align text-align-last text-decoration text-decoration-line " +
  "text-decoration-color text-decoration-style text-decoration-thickness text-decoration-skip-ink " +
  "text-underline-offset text-underline-position text-transform text-indent text-overflow " +
  "text-shadow text-rendering text-wrap text-wrap-mode text-wrap-style text-emphasis " +
  "text-emphasis-color text-emphasis-style text-emphasis-position text-orientation text-combine-upright " +
  "text-justify white-space white-space-collapse word-break word-wrap overflow-wrap hyphens " +
  "hyphenate-character line-break tab-size vertical-align writing-mode direction unicode-bidi " +
  "quotes content list-style list-style-type list-style-position list-style-image counter-reset " +
  "counter-increment counter-set " +
  // interactivity / ui
  "cursor pointer-events user-select touch-action resize appearance caret scroll-behavior " +
  "scroll-margin scroll-margin-top scroll-margin-right scroll-margin-bottom scroll-margin-left " +
  "scroll-padding scroll-padding-top scroll-padding-right scroll-padding-bottom scroll-padding-left " +
  "scroll-snap-type scroll-snap-align scroll-snap-stop overscroll-behavior overscroll-behavior-x " +
  "overscroll-behavior-y scrollbar-width scrollbar-color scrollbar-gutter " +
  // tables / svg / misc
  "table-layout caption-side empty-cells vertical-align object-fit object-position image-rendering " +
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin " +
  "stroke-dasharray stroke-dashoffset stroke-miterlimit paint-order shape-rendering stop-color " +
  "flood-color lighting-color " +
  "container container-type container-name contain content-visibility " +
  "break-before break-after break-inside page-break-before page-break-after page-break-inside orphans widows " +
  "all cx cy r rx ry d";

/** Known CSS property names (kebab-case). Membership test drives {@link isKnownCssProperty}. */
export const KNOWN_CSS_PROPERTIES: ReadonlySet<string> = new Set(CSS_PROPERTY_NAMES.split(" "));

const VENDOR_PREFIX = /^-(webkit|moz|ms|o)-/;

/**
 * Is `name` a real CSS property? Accepts camelCase or kebab-case (`borderColor` / `border-color`),
 * custom properties (`--brand`), and vendor-prefixed names (`-webkit-mask`). Everything else — a
 * reserved recipe key that leaked, or a typo — is rejected so the caller can fail loud.
 */
export const isKnownCssProperty = (name: string): boolean => {
  if (name.startsWith("--")) return true;
  const kebab = name
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (VENDOR_PREFIX.test(kebab)) return true;
  return KNOWN_CSS_PROPERTIES.has(kebab);
};
