---
"@theme-registry/refract": patch
---

Clearer prompts in `refract create` (and `npm create refract-theme`, which shares them). Multi-selects
now draw a `❯` cursor alongside `[✓]`/`[ ]` checkboxes, so focus and selection are separate signals —
previously only the label was bolded and it was hard to tell which row the keys would act on. The
harmony prompt shows the actual derived hues as colour swatches, and option hints align into a column.
