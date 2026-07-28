---
"@theme-registry/refract": patch
---

Round filled specimens, and make it obvious which string is a class name and what it is for.

**Filled specimens are rounded.** A square-cornered swatch reads as a flush block, and a `colors.border` rule-set in particular needs the curve for its stroke to be legible as a border rather than as a frame around the stage. The radius is written with `:where()`, giving it **zero specificity** — a theme that declares its own `border-radius` overrides it without a fight, which matters because the radius is the theme's business, not the preview's.

**The class name is now labelled.** Each specimen printed two monospace strings — a token address and a class name — with nothing saying which one you type into markup. The class now carries a `CLASS` chip beside it, so the two can't be confused.

**Each section says what its classes are applied to**, once per section rather than per card, since the answer is a property of the subsystem: colours go on the element you want coloured (and a `border` rule-set carries only the colour, so pair it with a width); layout goes on the container rather than its children; components go on the component root, and a composed recipe emits a class **list** whose order matters.
