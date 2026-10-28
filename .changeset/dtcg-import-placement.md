---
"@theme-registry/refract": patch
---

Import places each DTCG token on its own, reports what it did, and no longer invents colours.

**Colours keep their groups.** A colour's group path is now its property and its name the variant (`panel.alert.danger.hover` → `colors.panel-alert-danger.hover`), so tokens no longer overwrite each other because they share a second path segment: `border.primary`, `brand.primary` and `panel.main` used to collapse into one property. A group with no `$root` or `base` member takes its `default` member as base, else its first member in name order.

**New colour option `tones: false`.** It turns off the generated tones (the named `light`/`lighter`/`dark`/`darker` set and `steps`), leaving only the base and the variants you write. Every imported colour sets it, so an imported palette comes out exactly as designed, with no colours nobody chose.

**Tokens are placed one by one.** `$type` decides first, then the words in the token's path: radius → `borders.radius`, padding and gap → `layout.spacing`, font size → `typography.fontSize`, blur → `effects.blur`, and so on. A group mixing colours and dimensions is split rather than sent whole to one subsystem. Lengths keep their unit (`1.5rem` stays `"1.5rem"` instead of becoming `24`).

**Shadows build.** They are imported as structured layers whose colour is the imported colour they alias. Before, they were written as CSS strings, which `effects.shadow` rejects.

**Text styles become typography recipes**, one class per DTCG `typography` token, instead of anonymous per-property variants.

**New: `importDTCG(doc) → { raw, report }`.** The report lists where every token landed, every token left out and why, every base that had to be chosen, renames and parse diagnostics; `refract import` prints it. `fromDTCG` returns the same raw theme. The `./dtcg` size budget rises to 9 KB gzip.
