---
"@theme-registry/refract": patch
---

Generator settings no longer show up as tokens. A colour's `lightenBy`, `darkenBy` and `harmony`, and the type scale's `ratio`, `precision`, `baseFontSize` and `unit`, were listed in `theme.tokens` (`colors.brand.lightenBy = 10`, `typography.fontSize.ratio = "major-third"`), so `toDTCG`, the MCP tools and the emitted manifest reported them as design tokens. They were never written to CSS, and the tokens they generate are unchanged.
