# Project Agent Instructions

## Branding System (UI/Frontend)

Apply these rules for all new pages and UI updates.

### Brand Direction

- Tone: calm, trustworthy, pastoral, community-focused.
- Visual character: soft natural greens + warm neutrals, high whitespace, understated UI.
- Composition: full-bleed sections that alternate between dark, light, and white theme blocks.

### Core Palette

- `--cg-white`: `#FFFFFF`
- `--cg-light-accent`: `#F7F5F1`
- `--cg-accent`: `#B7C9BB`
- `--cg-dark-accent`: `#496D59`
- `--cg-ink`: `#052E1E`

### Section Theme Modes

Use section-level themes instead of ad-hoc one-off color rules:

- `black-bold`: bg `#052E1E`, text `#FFFFFF`, CTA/accent `#B7C9BB`
- `dark-bold`: bg `#496D59`, text `#FFFFFF`, CTA/accent `#B7C9BB`
- `light`: bg `#F7F5F1`, text `#052E1E`, CTA `#052E1E`
- `white-bold`: bg `#FFFFFF`, text `#052E1E`, CTA `#052E1E`

### Typography

- Font family: `Poppins` across UI.
- Headings: `700`, line-height `1.2`.
- Body: `300`, line-height `1.3`.
- Meta/supporting: `400`, line-height `1.6`.
- Scale: `h1 4rem`, `h2 1.8rem`, `h3 1.4rem`, `h4 1.2rem`, body `1rem`, small `0.9rem`.
- Navigation labels/site labels: uppercase, `500`, letter-spacing `2px`.

### Layout + Spacing

- Max content width: `1200px`.
- Gutters: `3vw` desktop, `6vw` mobile.
- Header style: transparent-over-hero, full-width, not fixed.
- Section rhythm: generous vertical spacing; alternate dark statement and light/white content sections.

### Buttons

- Primary: solid fill, uppercase `500`, pill shape, high contrast.
- Secondary: outline style, same typography, pill shape.
- Tertiary: outline/underline treatment.
- In dark sections, invert CTA contrast for readability.

### Imagery + Motion

- Prefer candid, human-centered community/counselling imagery.
- Use subtle dark overlays on image heroes for text legibility.
- Keep image saturation restrained and natural.
- Motion should be subtle reveal (`fade + slide`, ~`0.8s`, `ease`).

### Accessibility + Guardrails

- Maintain WCAG 2.1 AA contrast, including text over photos.
- Reuse restrained palette; do not introduce bright competing hues.
- Favor reusable theme classes over page-specific one-off styles.
