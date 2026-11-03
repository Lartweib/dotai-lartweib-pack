---
name: lartweib-taste
description: The maintainer's UI expectations; overrides other design skills' house rules. Load with impeccable to design, restyle or review a UI.
metadata:
  author: Federico Ara
---

# lartweib-taste

This skill holds what the maintainer expects from a UI, not a style. It sets no palette, font or theme: each product's concept decides those. For method, use the other design skills:

| Need | Skill |
|---|---|
| Process: shape, craft, audit, polish | `impeccable` |
| Compliance review | `web-design-guidelines` |
| Mobile adaptation | `impeccable` (`adapt`) |

## Precedence

Highest wins:

1. The project's `DESIGN.md`, tokens, or the maintainer's own mockups. Build mockups faithfully, list every deviation and give a reason for it.
2. This skill.
3. The house rules of the other design skills. Their fixed bans and reject lists (fonts, monospace, eyebrows, gradients, glows, cream grounds, scroll effects) never veto a choice the product's concept calls for. Say in the report which rules you waived.

## 1. The bar

- The target reaction is "you can tell it was made with love and care": premium and crafted, at award-site level. "Made by AI in 2 minutes" is a failure even when the page works.
- Rejection words to recognise: genérico, hecho con IA, de manual, simplón, prototipo, soso, "parece un Jira". When you hear one, the direction failed, not a detail. Re-propose; don't patch.
- Never reuse a previous project's look. Fonts, palette and theme are chosen per product.

## 2. Identity

- Every product gets its own concept and world, and every component belongs to it: buttons, toggles, icons, tooltips, the scrollbar, empty states and the 404 page. A generic control on a themed page is a bug.
- Type has character on brand surfaces. A plain font that conveys nothing is rejected there. Body text stays readable.
- Color has meaning (yours, active, primary), never decoration.
- Surfaces are not flat and empty by default: give them a material that fits the concept.
- The product's own assets come first (real screenshots, game sprites at integer scale). The rest stays crisp, logos included.

## 3. Motion

Motion is where the maintainer most wants detail and where agents most often fall short.

- Smooth, delicate and slightly slow, so it can be appreciated. If in doubt, slow it down a little.
- Reveals feel drawn: items appear in sequence and leave in reverse; nothing teleports between states.
- Interaction feedback is rewarding to look at (hover, complete, discard, view changes).
- Effects stay clean and subtle: one or two flourishes, never one after another.
- Banned: abrupt expansions, motion that is too fast or janky, blinking cursors and blinking UI, hurried effects next to a delicate page.
- `prefers-reduced-motion` makes motion gentler, not absent.

## 4. Precision (the most frequent correction)

- Symmetry and alignment: sibling cards share structure, titles line up, columns align, centred things are centred.
- Spacing is consistent between sections; gaps that are too large or too cramped both get flagged.
- Text never overflows a card, pill or cell. Long content is handled on purpose (truncate plus a themed tooltip).
- Content keeps a coherent max-width on every page; nothing runs full-width on 4K.
- In app shells, panes absorb extra width: no dead gutter when a sidebar collapses.
- Type sizes do not jump while reading on mobile.

### On phones

- Full-height layouts use `dvh` or `svh`, never bare `100vh`; fixed and sticky elements pad with `env(safe-area-inset-*)`, which needs `viewport-fit=cover` in the viewport meta.
- Primary actions sit within thumb reach (bottom third); taps are 44px or larger.
- Nothing is hover-only; form fields are 16px or larger, so iOS does not zoom.
- Desktop patterns get a mobile form, not a shrunk copy: a table becomes cards, a modal a bottom sheet, a wide sidebar a bottom nav or a drawer. Each keeps the product's identity.
- No horizontal scroll at 320px.

## 5. Hard bans

- Emoji as icons or in UI copy.
- A generic AI-dashboard look, or a Jira-style table as the main view of a tool.
- Decorative leftovers that read as artefacts, such as gradient fades over text boxes.
- Controls foreign to the project's system.
- Copy that over-promises or misleads.

## 6. Process

1. Before building a new surface, offer 3 to 5 clearly different options, or one premium candidate plus radical alternatives. Keep each option modular: the maintainer often combines parts of several.
2. Then build without asking at every step; the maintainer expects judgment, not hand-holding.
3. Verify in a real browser at 320px, mobile, tablet, desktop and 4K widths, and look at the screenshots before claiming done: alignment, overflow, spacing, max-width and motion timing are what gets reported back.
4. Take principles from at most three reference sites or brands, never their identity.
