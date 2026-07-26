---
"@theme-registry/refract": patch
---

Interactive prompts now respond to arrow keys. `refract create` (and `npm create refract-theme`,
which shares the interview) navigates with ↑/↓, toggles multi-selects with space, `a` for all/none,
and Enter to confirm — instead of typing option numbers. Falls back to the numbered prompts when a
terminal refuses raw mode, and still takes defaults with no TTY at all.
