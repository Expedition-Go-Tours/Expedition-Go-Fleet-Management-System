# United Carriers — Production Design System / `design.md`

> **Purpose:** A machine-readable design specification for rebuilding an app/site with the **visual language, layout behavior, interaction patterns, responsive rules, and motion character** of `https://unitedcarriers.com/`.
>
> **Research date:** 2026-09-27  
> **Primary source:** live United Carriers site  
> **Supplemental implementation source:** a public static mirror captured from the same Webflow build (published 2026-08-07) that exposes the Webflow CSS, custom CSS, asset structure, and measured interaction behavior.  
> **Important:** Where an exact source token could not be resolved from the minified Webflow stylesheet, this document labels the value as `INFERRED` or `IMPLEMENTATION TOKEN` instead of pretending it was directly extracted.

---

## 0. Agent instructions

### 0.1 Design target

Recreate the **design language**, not the business copy:

- premium B2B logistics
- industrial / technical
- dark, cinematic hero
- oversized geometric typography
- extremely restrained UI chrome
- black/white base palette with a vivid warm accent
- editorial spacing rather than dense dashboard spacing
- real-world logistics photography mixed with product/industrial cutouts
- scroll-driven storytelling
- sticky/pinned scenes
- subtle but deliberate micro-motion
- strong contrast and simple interaction vocabulary

### 0.2 Core rule

The page should feel **expensive, controlled, spatial and cinematic** rather than “startup SaaS”. Avoid:

- generic gradient-heavy SaaS layouts
- rounded-everything card UI
- excessive shadows
- excessive borders
- bright multi-color palettes
- tiny UI copy everywhere
- default system font appearance
- generic stock logistics hero imagery

### 0.3 Implementation priority

When exact measurements conflict with convenience, preserve this order:

1. typography scale and visual hierarchy
2. container/grid alignment
3. section rhythm / whitespace
4. black/white/gray palette
5. image cropping and art direction
6. scroll/motion behavior
7. micro-interactions

### 0.4 Source-of-truth notation

- `VERIFIED` — directly observed in the live site or source CSS/custom CSS.
- `MEASURED` — explicitly measured/documented by the public mirror/reverse-engineering notes.
- `HIGH-CONFIDENCE` — strongly supported by the same Webflow implementation but not directly exposed in the browser text extraction.
- `INFERRED` — implementation value chosen because the source variable itself was not machine-resolvable during this research.
- `IMPLEMENTATION TOKEN` — a clean tokenized equivalent for a new codebase; intended to reproduce the look without inheriting Webflow class names.

---

# 1. Visual identity

## 1.1 Overall aesthetic

**Keywords:**

`industrial` · `editorial` · `cinematic` · `technical` · `global` · `premium` · `minimal` · `precise` · `high-contrast`

The visual system is anchored by black and white surfaces, oversized display type, pill controls, monospaced uppercase labels, precision spacing, and logistics imagery. The homepage hero historically used a luminous globe/route visualization; current live content retains that cinematic, network-oriented character.

## 1.2 Visual density

- Hero: **low density**, very large negative space.
- Editorial sections: **medium density**, large type plus short explanatory copy.
- Service sections: **medium density**, image + title + concise paragraph.
- FAQ/filters: denser but still spacious.
- Footer: compact navigation grouped by semantic areas.

## 1.3 Geometry language

Prefer:

- full-bleed sections
- hard horizontal/vertical alignment
- large rounded pills only for CTA controls
- large-radius visual cards when they are part of a cinematic scroll scene
- almost no decorative borders
- image crops that hit exact container edges
- asymmetric visual composition around a strong grid

---

# 2. Root sizing / viewport math

The Webflow build uses a viewport-relative root font size instead of the normal `16px` root.

### 2.1 Root scale

```css
html {
  font-size: 0.57870370373vw;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (max-width: 991px) {
  html { font-size: 1.0090817356vw; }
}

@media (max-width: 767px) {
  html { font-size: 2.5445292621vw; }
}
```

This produces approximately `10px` per `1rem` at the reference widths `1728px`, `991px`, and `393px`. The reverse-engineered source explicitly documents this conversion.

### 2.2 New-code equivalent

For a new app, expose the behavior as a single token rather than scattering viewport math:

```css
:root {
  --root-scale-desktop: 0.57870370373vw;
  --root-scale-tablet: 1.0090817356vw;
  --root-scale-mobile: 2.5445292621vw;
}

html { font-size: var(--root-scale-desktop); }
@media (max-width: 991px) {
  html { font-size: var(--root-scale-tablet); }
}
@media (max-width: 767px) {
  html { font-size: var(--root-scale-mobile); }
}
```

**Do not** replace this with a fixed `16px` root when pixel-level visual matching is important; doing so changes every `rem` measurement used by the original design.

---

# 3. Responsive breakpoints

| Token | Value | Meaning |
|---|---:|---|
| `bp-mobile` | `< 768px` | phone layout |
| `bp-tablet` | `768–991px` | tablet / compact desktop |
| `bp-desktop` | `>= 992px` | full navigation + multi-column layout |
| `bp-mobile-short` | `<= 520px` height | landscape / short viewport correction |

The header/nav behavior explicitly uses `992px` and `768px` as key thresholds.

Recommended aliases:

```css
--bp-mobile: 767px;
--bp-tablet-min: 768px;
--bp-desktop: 992px;
--bp-mobile-short-height: 520px;
```

---

# 4. Grid and container system

## 4.1 Column counts

The debugging grid in the Webflow build documents a responsive column system:

- desktop: **16 columns**
- tablet: **8 columns**
- mobile: **4 columns**

The public implementation notes also document `2rem` column gaps on desktop/tablet and `1.6rem` on mobile.

## 4.2 Column gap

```css
--grid-gap-desktop: 2rem;
--grid-gap-tablet: 2rem;
--grid-gap-mobile: 1.6rem;
```

At the reference root scale these are approximately `20px / 20px / 16px`.

## 4.3 Container padding

The custom header stylesheet overrides the default Webflow container padding to:

```css
/* desktop */
--container-padding: 2.4rem;

/* <=991 */
--container-padding: 2rem;
```

The source comments identify the Webflow theme default as larger and the chosen values as the minimum safe values for the grid.

Recommended implementation:

```css
--page-gutter-desktop: 2.4rem;
--page-gutter-tablet: 2rem;
--page-gutter-mobile: 2rem;
```

## 4.4 Container formula

The source uses a true grid container rather than a simple `max-width + margin:auto` wrapper.

Conceptually:

```css
--padding-inline: calc(var(--container-padding) - var(--grid-gap));
--content-max-width: calc(var(--container-max-width) - (var(--container-padding) * 2));
```

Content sits inside the named `[content-start] ... [content-end]` range, while full-bleed elements use a separate `[full-width-start] ... [full-width-end]` range.

### New-code abstraction

```tsx
<Container>
  <Grid columns={{desktop: 16, tablet: 8, mobile: 4}}>
    <GridItem span="..." />
  </Grid>
</Container>
```

Do not create one-off arbitrary margins per section. Keep the page aligned to the global grid.

## 4.5 Max-width

`--container--max-width` exists in the source grid system, but the exact underlying value was not exposed in the browser-readable source used for this research.

**Implementation token:**

```css
--container-max-width: 1920px; /* INFERRED — verify against target viewport */
```

For a production recreation, treat this as the only top-level geometry token still requiring a visual browser check before freezing.

---

# 5. Color system

The site is primarily monochrome. The most reliable values visible in the extracted implementation are below.

## 5.1 Base colors

```css
--color-black: #000000;
--color-near-black: #0c1016;
--color-black-text: #111111;
--color-white: #ffffff;
--color-neutral-900: #1e1e1e;
--color-neutral-800: #23272d;
--color-neutral-700: #3a3e44;
--color-neutral-600: #50555a;
--color-neutral-500: #a5abad;
--color-neutral-400: #d9d9d9;
--color-neutral-300: #333333;
```

The service-stack implementation exposes exact dark-card values `#0c1016`, `#23272d`, `#3a3e44`, `#50555a`, corresponding tag surfaces, plus title secondary text `#a5abad`.

## 5.2 Warm accent

The live experience visibly uses a saturated warm orange for interactive/highlight moments. The extracted CSS contains `#f50` as an active hover color.

```css
--color-accent: #ff5500;
```

Use this **sparingly**:

- active/hover accents
- selected navigation states
- tiny emphasis points
- route/glow details in network visualizations

Do not turn the whole interface orange.

## 5.3 Secondary interaction colors

Exact values surfaced in the source include:

```css
--color-link-hover: #0016cb;
--color-error: #df2020;
--color-icon-neutral: #373737;
--color-hero-secondary: #a5abad;
```

`#0016cb` is used by the cookie preference hover state; `#df2020` is used for form errors.

## 5.4 Suggested semantic aliases

```css
--bg-page: var(--color-white);
--bg-dark: var(--color-black);
--bg-panel-1: #0c1016;
--bg-panel-2: #23272d;
--bg-panel-3: #3a3e44;
--bg-panel-4: #50555a;

--text-primary: #111111;
--text-on-dark: #ffffff;
--text-muted: #a5abad;
--text-subtle: #d9d9d9;

--action-primary: #111111;
--action-primary-text: #ffffff;
--action-accent: #ff5500;
--action-link-hover: #0016cb;
```

---

# 6. Transparency / alpha language

Use alpha rather than many extra gray tokens.

Known source examples:

```css
/* subtle notice copy / borders */
rgba(17,17,17,0.4); /* shorthand source appeared as #1116 */

/* hero dots */
opacity: 0.075;
```

The hero point field starts extremely subtle and should feel atmospheric rather than decorative.

---

# 7. Typography system

## 7.1 Font roles

The original United Carriers visual system is documented as using:

- **Display / headings:** BT Steinhart — geometric/cubic display character.
- **Body:** Helvetica Neue.
- **Uppercase UI labels / buttons:** BT Steinhart Mono.

The public mirror documents that its rebrand deliberately replaced the original display font with Outfit; it explicitly identifies **BT Steinhart as the original display face** and **BT Steinhart Mono for labels/buttons**, while retaining Helvetica Neue for body text. Therefore do not confuse the mirror's rebrand fonts with the original United Carriers brand font.

### Font role tokens

```css
--font-display: "BT Steinhart", "Helvetica Neue", Arial, sans-serif;
--font-body: "Helvetica Neue", Arial, sans-serif;
--font-ui-mono: "BT Steinhart Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

## 7.2 Rendering

```css
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  color: var(--text-primary);
}
```

## 7.3 Display characteristics

The design uses **large size + tight leading + negative tracking**.

Implementation defaults:

```css
--tracking-display: -0.045em;
--tracking-heading: -0.03em;
--tracking-body: 0;
--tracking-ui: 0.04em;
```

The service-stack title implementation explicitly uses `letter-spacing: -0.05em` and `line-height: 1`.

## 7.4 Type scale

These are **implementation equivalents**, not a claim that every size is an exposed source variable:

| Token | Desktop | Tablet | Mobile | Typical use |
|---|---:|---:|---:|---|
| `display-xl` | `5.6vw` | `5.6vw` | `12.55vw` hero-specific | main hero |
| `display-lg` | `9.6rem` | `7.2rem` | `4.8rem` | cinematic cards |
| `display-md` | `7.2rem` | `6.4rem` | `4.0rem` | section headings |
| `heading-lg` | `5.6rem` | `4.8rem` | `3.6rem` | primary section heading |
| `heading-md` | `4.0rem` | `3.6rem` | `3.0rem` | subsection heading |
| `body-lg` | `2.4rem` | `2.1rem` | `2.1rem` | hero/lead paragraph |
| `body-md` | `1.8rem` | `1.8rem` | `1.8rem` | primary body |
| `body-sm` | `1.6rem` | `1.6rem` | `1.6rem` | supporting copy |
| `ui-sm` | `1.2rem` | `1.2rem` | `1.2rem` | buttons / labels |
| `ui-xs` | `1.0rem` | `1.0rem` | `1.0rem` | metadata |

The hero implementation notes document `5.6vw` as the desktop display size, `12.55vw` on mobile for a later/current hero treatment, and `2.4rem` for the enlarged desktop hero description in the mirror.

## 7.5 Line-height

```css
--leading-display: 0.9;
--leading-display-tight: 0.875;
--leading-heading: 1;
--leading-body: 1.2;
--leading-body-relaxed: 1.35;
--leading-ui: 1;
```

The source explicitly uses `1`, `0.875`, and `1.2` in different type systems.

## 7.6 Uppercase rules

Use uppercase for:

- button labels
- nav labels where the component uses mono styling
- small section kicker/eyebrow labels
- metadata labels

Do **not** uppercase body paragraphs.

The site uses display typography that can appear uppercase while the source title itself can remain mixed-case; therefore prefer CSS `text-transform` only on the component that needs it.

---

# 8. Spacing system

The source is fundamentally a `0.8rem / 1.6rem / 2.4rem ...` rhythm.

Recommended token set:

```css
--space-1: 0.4rem;   /* 4px at 10px root */
--space-2: 0.8rem;   /* 8px */
--space-3: 1.2rem;   /* 12px */
--space-4: 1.6rem;   /* 16px */
--space-5: 2.0rem;   /* 20px */
--space-6: 2.4rem;   /* 24px */
--space-7: 3.2rem;   /* 32px */
--space-8: 4.0rem;   /* 40px */
--space-9: 4.8rem;   /* 48px */
--space-10: 5.6rem;  /* 56px */
--space-11: 6.4rem;  /* 64px */
--space-12: 8.0rem;  /* 80px */
--space-13: 9.6rem;  /* 96px */
--space-14: 12.8rem; /* 128px */
--space-15: 16.0rem; /* 160px */
```

Observed source examples include `3.2rem` navigation gap, `4.8rem/6.4rem` card padding, `6.4rem` internal card spacing, and `12.8rem` service-section offset.

### Spacing principle

Prefer **fewer, larger gaps** rather than many small ones.

Typical vertical pattern:

```text
eyebrow
↓ 24–32px
headline
↓ 24–40px
supporting paragraph
↓ 32–48px
CTA row
```

Section-to-section spacing should often be measured in viewport-relative units (`vh`, `svh`) when the scene is cinematic.

---

# 9. Radius system

Use radius as a semantic cue:

```css
--radius-none: 0;
--radius-sm: 0.4rem;
--radius-md: 0.6rem;
--radius-lg: 2rem;
--radius-xl: 3.2rem;
--radius-2xl: 4.8rem;
--radius-pill: 10vmin;
```

Observed exact values include `0.6rem` for the cookie preference modal, `2rem` for a holographic card, `3.2rem` and `4.8rem` for the services stack, and `10vmin` for pill-shaped cookie/action controls.

### Usage

- CTA/button: `pill`
- small modal: `md`
- editorial cards: `lg–xl`
- cinematic stack: `xl–2xl`
- hero/background: usually none

---

# 10. Borders, strokes, shadows

## 10.1 Borders

Default UI border:

```css
--border-width: 0.1rem;
```

Use borders only when necessary for:

- input affordance
- menu divider
- modal separation
- logo/image framing

The design generally gets structure from **spacing + contrast**, not from boxes.

## 10.2 Shadows

Do not use large conventional card shadows by default.

For dark cinematic 3D objects, use:

- opacity changes
- blur/glow in the image/canvas itself
- subtle drop shadows only when they help depth

---

# 11. Buttons and CTA controls

## 11.1 Primary CTA

Visual form:

- white or black fill depending on surface
- pill radius
- short uppercase label
- monospaced / technical label face
- minimal icon
- high contrast

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  min-height: 4.8rem;
  padding: 1.4rem 2.4rem;
  border: 0.1rem solid currentColor;
  border-radius: 10vmin;
  font-family: var(--font-ui-mono);
  font-size: 1.2rem;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
  transition:
    color 0.4s ease,
    background-color 0.4s ease,
    border-color 0.4s ease,
    transform 0.4s ease;
}
```

The source documents uppercase mono labels and pill geometry; the exact cookie-control implementation uses `1rem`, `10vmin`, and `1.6rem 2.8rem 1.5rem` padding. Use that as the tight UI reference while allowing the primary CTA to scale slightly larger.

## 11.2 Dark-surface CTA

On a dark section:

```css
background: #fff;
color: #111;
border-color: #fff;
```

The header explicitly uses this inversion on dark backgrounds.

## 11.3 Hover motion

The site's link/button interactions are mostly **movement-based**, not glow-based.

For arrow CTA:

```css
.btn-arrow {
  transition: transform 0.6s cubic-bezier(0.66, 0, 0.15, 1);
}

.btn:hover .btn-arrow {
  transform: translate(100%, -100%);
}
```

The source uses a `0.6s` custom cubic-bezier for line/hover motion and an arrow that translates out of frame.

---

# 12. Links / underlines

## 12.1 Default inline link

- inherits color
- no permanent underline for main navigation
- underline appears as a reveal animation for certain textual links

## 12.2 Underline animation

The source implementation:

- line is positioned at roughly the bottom of the text
- line begins at scale `0`
- expands from right-to-left or left-to-right depending on state
- transition: `0.6s cubic-bezier(0.66, 0, 0.15, 1)`

Implementation:

```css
.link-reveal::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0.1em;
  width: 100%;
  height: var(--border-width);
  background: currentColor;
  transform: scaleX(0);
  transform-origin: right;
  transition: transform 0.6s cubic-bezier(0.66,0,0.15,1);
}

.link-reveal:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}
```

This is directly modeled from the shared Webflow hover utility.

---

# 13. Header / navigation

## 13.1 Layout

Desktop header:

```text
┌──────────────────────────────────────────────────────────────┐
│ LOGO     [nav links ……………………………]         [WORK WITH US] │
└──────────────────────────────────────────────────────────────┘
```

The source notes that the navigation is a single horizontal row centered on the CTA's vertical axis and that the right side terminates before the CTA with a fixed rem-based gap. Exact custom value:

```css
.header-menu-list {
  display: flex;
  flex-flow: row;
  align-items: center;
  column-gap: 3.2rem;
  top: 0;
  bottom: 0;
  right: 22rem;
}
```

citeturn966152view3

## 13.2 Header container

```css
.header {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 100;
}
```

The implementation deliberately keeps the header visible while scrolling rather than hiding it completely.

## 13.3 Header padding

Verified custom values:

```css
.header-inner {
  padding-top: 2.6rem;
}

@media (max-width: 991px) {
  .header-inner > .container {
    --container-padding: 2rem;
  }
}
```

On mobile, the implementation notes document approximately `3.8rem` top reserve to keep the logo from colliding with the viewport edge.

## 13.4 Header responsive behavior

### >= 992px

- full nav row visible
- Work with us CTA visible
- LinkedIn/social utility may be present on larger layouts

### 768–991px

- compact header behavior
- desktop list is reduced/transitioned toward menu treatment

### < 768px

- compact fixed bar
- menu control instead of full nav
- header becomes more carefully isolated from the scrolling container

The source specifically switches behavior at `992px` and `768px`.

## 13.5 Header state transitions

When the page moves between light and dark scenes:

- logo color must track background
- CTA fill/text must invert as required
- state should be based on **what is actually underneath the header**, not just route/page

The reverse-engineered implementation used a contrast observer to solve this dynamically.

## 13.6 Header motion

Observed/implemented timings:

```css
--header-link-stagger: 22ms;
--header-menu-delay: 190ms;
--header-hover-duration: 400ms;
--header-social-in-duration: 550ms;
```

Six nav links are staggered with `22ms` increments. The menu control enters after a `190ms` delay.

---

# 14. Hero system

## 14.1 Composition

The hero is the signature visual system.

Current live hero content:

- kicker: `One operator`
- oversized title: `Every leg of the journey`
- short descriptor
- two CTAs
- black cinematic background
- logistics/global-network visualization

Live page structure is documented in the current homepage source.

## 14.2 Background

Original current experience:

- near-black background
- luminous blue globe/network form
- warm/orange route lines and markers
- technical/global-network feel
- animated 3D/canvas treatment rather than a static hero image

A design capture of the homepage shows the black hero, large white title, blue luminous globe, orange route arcs and location markers.

## 14.3 Hero content alignment

The reverse-engineered contemporary hero uses a full-width centered content block on desktop:

```css
.home-hero-text-wrap {
  align-items: center;
  text-align: center;
  justify-content: center;
  padding-top: 7.55rem;
  padding-bottom: 0;
}
```

citeturn966152view3

For reproductions of the **current live United Carriers composition**, center the hero content unless a screenshot-specific recreation requires a different art direction.

## 14.4 Hero title

Implementation baseline:

```css
.hero-title {
  font-family: var(--font-display);
  font-size: 5.6vw;
  line-height: 0.9;
  letter-spacing: -0.045em;
  text-transform: uppercase;
  font-weight: 600;
  max-width: 12ch;
}
```

The captured/reverse-engineered hero implementation explicitly documents `5.6vw` as the large-screen display size, with a larger mobile size to maintain the same visual dominance.

## 14.5 Hero supporting copy

Desktop visual target:

- width: around `72rem` max in the documented modern hero treatment
- large enough to read as part of the hero, not as tiny metadata
- line length deliberately controlled

Source value:

```css
.home-hero-desc { max-width: 72rem; }
.home-hero-desc .txt { font-size: 2.4rem; }
```

citeturn966152view3

## 14.6 Mobile hero

Under `768px`:

- left-align content
- anchor the composition closer to the bottom
- use `svh` instead of ordinary `vh` for viewport-sensitive vertical spacing
- keep CTA buttons on the same row whenever width allows

Observed values:

```css
padding-bottom: 9svh;
.hero-label { margin-bottom: 2.4rem; }
.hero-label-text { font-size: 2rem; }
.hero-cta-text { font-size: 1.2rem; }
```

citeturn966152view4

### Short viewport correction

For `<768px` width and `<=520px` height:

```css
padding-bottom: 4vh;
hero-label-margin-bottom: 1.2vh;
hero-label-size: 3.8vh;
hero-title-size: 8.5vh;
hero-title-margin-bottom: 3vh;
hero-body-size: 3.8vh;
hero-body-margin-bottom: 3.4vh;
hero-cta-padding-y: 1.8vh;
hero-cta-padding-x: 3.6vh;
hero-cta-font: 3vh;
```

These values are explicitly documented by the measured implementation.

---

# 15. Hero motion / ambient background

## 15.1 Dot-grid wave

The reverse-engineered hero-dot system is highly specific and should be treated as a signature interaction.

Exact documented values:

```js
const HERO_DOTS = {
  gridStep: 29,          // px
  minGridStep: 20,       // px
  restingOpacity: 0.075,
  restingRadius: 0.04,   // fraction of grid step
  waveIntervalMs: 7000,
  waveTravelMs: 6000,
  crestHalfWidthD: 0.075,
  centerX: 0.494,
  centerY: 0.565
};
```

The wave is designed to traverse the entire hero in approximately six seconds and recur every seven seconds.

## 15.2 Cursor energy

The hover effect should **augment the wave**, not become an unrelated cursor halo.

Observed interaction timings:

```css
--cursor-glow-in: 170ms;
--cursor-glow-out: 520ms;
--cursor-idle-threshold: 120ms;
```

The source notes a tapered trailing influence, with maximum influence rather than additive accumulation, plus a slow wandering offset so the shape does not freeze into a perfect circle.

## 15.3 Reduced motion

When `prefers-reduced-motion: reduce`:

- remove wave expansion
- remove cursor trail
- remove staggered hero text reveal
- keep the hero fully visible immediately
- preserve composition, not animation

---

# 16. Section transition language

The site commonly moves between large black and white scenes instead of placing each section in an isolated bordered card.

Use:

- white → white with image interruption
- white → black with a strong visual cut
- black → image/3D → white
- large top/bottom whitespace
- occasional wave or non-rectangular transition when the art direction requires it

Avoid:

- 1px divider between every section
- every section using a different background color
- repetitive card grids

---

# 17. Homepage architecture

The current homepage contains the following high-level story:

1. **Hero** — “One operator / Every leg of the journey” + CTAs.
2. **Promise / positioning** — “We move freight. We own the outcome.”
3. **Proof statistics** — shipments/month, on-time rate, years in operation.
4. **Services** — air, ocean, customs, warehouse/3PL, project cargo, domestic/interstate.
5. **Reliability** — real-time tracking, network coverage, 24/7 support.
6. **Why us / differentiation** — one point of contact, visibility, compliance, pricing, issue resolution.
7. **Testimonials**.
8. **Partners / airlines / ecosystem logos**.
9. **Industry insights / latest movement**.
10. **FAQ**.
11. **Final CTA + footer**.

This ordering and copy hierarchy are visible in the current homepage source.

---

# 18. Intro / positioning section

## Visual structure

Use a white/light section with:

- large heading
- 1–2 short paragraphs
- one prominent editorial image
- CTA/link
- statistics beneath or adjacent

Current live copy structure shows the heading split into multiple short lines to create editorial rhythm.

## Stats

Use very large numeric values and compact labels:

```css
.stat-value {
  font-family: var(--font-display);
  font-size: clamp(4rem, 6vw, 10rem);
  line-height: 0.9;
  letter-spacing: -0.04em;
}

.stat-label {
  font-family: var(--font-ui-mono);
  font-size: 1.2rem;
  text-transform: uppercase;
}
```

Current source uses `2,500+`, `98.2%`, and `8+` as the primary proof numbers.

---

# 19. Services system

## 19.1 Service categories

The core services are:

- Air Freight
- Ocean Freight
- Customs Brokerage
- Warehousing & 3PL
- Project Cargo
- Domestic & Interstate Transport

The live site repeats this service family across homepage and Services page.

## 19.2 Card-stack treatment

The public implementation documents a sticky stack inspired by the same interaction language used by the live site:

- section is approximately `350vh`
- inner sticky stage is `100vh`
- cards enter from `translateY(120%)`
- previously settled cards shift upward by `60px`
- scales progressively: `0.95`, `0.90`, `0.85`
- animation easing: `power1.out`
- first card may briefly scale from `1.05 → 1`

citeturn276697view4turn276697view5

## 19.3 Exact cinematic card tokens

```css
--service-card-radius-desktop: 4.8rem;
--service-card-radius-mobile: 3.2rem;
--service-card-padding-desktop: 6.4rem;
--service-card-padding-mobile-y: 4.8rem;
--service-card-padding-mobile-x: 2.4rem;
--service-card-title-desktop: 9.6rem;
--service-card-title-mobile: 4.8rem;
--service-card-title-tracking: -0.05em;
```

The exact implementation also exposes four grayscale dark-surface values:

```css
#0c1016
#23272d
#3a3e44
#50555a
```

plus slightly darker tag surfaces.

## 19.4 Mobile service behavior

Below the desktop threshold, do **not** force the stacked overlap effect.

Use:

- one card per row
- natural document flow
- subtle translate/scale reveal
- full-width image/illustration

The reverse-engineered CSS explicitly changes the stacked desktop arrangement to a column on smaller layouts.

---

# 20. Reliability section

Current homepage architecture uses three reliability promises:

1. Real-Time Freight Tracking
2. Global Network Coverage
3. 24/7 Customer Support

citeturn691920view1

## Visual recipe

Use three large editorial feature blocks:

```text
[large visual]
short mono label
large heading
1–2 line explanatory copy
```

Do not use dashboard-style icon cards unless the application being built genuinely requires interactive status UI.

---

# 21. “Why us” / differentiator cards

Documented themes:

- One Point of Contact
- Full Supply Chain Visibility
- Compliance You Can Trust
- Competitive, Transparent Pricing
- Fast Issue Resolution

citeturn691920view2

Implementation recommendation:

```css
.feature-item {
  min-height: 22rem;
  padding-block: 3.2rem;
  border-top: 0.1rem solid rgba(17,17,17,0.14);
}
```

Use a strong left title and a compact explanatory paragraph on the right for desktop; stack them on mobile.

---

# 22. Testimonials

The site uses testimonial content as **editorial proof**, not as star-rated SaaS reviews.

Visual characteristics:

- oversized quote typography
- person name
- job title
- organization
- portrait/image
- generous whitespace
- horizontal or slide-based treatment

The homepage source contains long-form customer quotes and named roles/companies.

### Do not add

- five-star icon rows
- review platform logos unless needed by the actual product
- dense review cards with tiny text

---

# 23. Partner/logo strip

The homepage includes a partner ecosystem section containing airline and logistics-related logos.

## Logo treatment

- monochrome or controlled grayscale
- uniform visual height rather than uniform width
- generous whitespace
- horizontal marquee/loop can be used
- no colored logo blocks

For moving logos, use a long linear marquee:

```css
animation: marquee 30s linear infinite;
```

The original shared CSS documents a `30s` linear marquee utility.

---

# 24. Insights / editorial system

The current site has a substantial Insights area with category filters and article cards. Categories include:

- Featured
- Company News
- Industry News
- Case Studies
- Company Updates
- Market Updates
- AI news
- Global
- Europe
- Rest of World
- Middle East & Africa
- Asia
- Americas
- Asia Pacific
- Company Update
- LinkedIn/social updates

citeturn229982search2

## Article card visual recipe

```text
image
category / date
headline
short excerpt
arrow / read affordance
```

Use large image crops and short text. The design should feel like an editorial publication, not a blog CMS dashboard.

## Filters

Filters should be compact and technically styled:

- uppercase labels
- mono font
- minimal borders
- selected state by fill/contrast rather than heavy shadow

---

# 25. FAQ system

The homepage uses a straightforward FAQ section with a large heading and compact expandable items.

## Visual rules

```css
.faq-item {
  border-top: 0.1rem solid rgba(17,17,17,0.15);
  padding-block: 2.4rem;
}

.faq-title {
  font-family: var(--font-display);
  font-size: 2.4rem;
  line-height: 1;
}
```

Interaction:

- click/tap row
- open with height/clip + opacity
- 300–500ms ease-out
- no bounce
- active row may use accent or stronger black

---

# 26. Footer

The footer is a high-contrast closing block with:

- large brand line
- grouped navigation
- social links
- company/legal links
- contact details
- CTA

The homepage closes with “Ready to move smarter?” and a final contact/work-with-us CTA before the footer navigation.

## Footer structure

```text
[brand statement]

[Socials]       [Company]
LinkedIn        Home
                Insights
                Industries
                About us
                Services
                Careers
                Community
                Contact us

[legal / payment / policy]
```

---

# 27. About page design

Current About page sections include:

- large introductory title
- company story
- alignment / visibility / accountability framework
- technology/systems support
- trusted associations/partners
- “our difference” statements
- Vision / Mission / Strategy
- values
- global trade network
- leadership/team
- FAQ
- final CTA/contact information

citeturn229982search0

## Visual treatment

The About page should keep the same shell as the homepage but shift from cinematic network visuals to:

- strong editorial photography
- human/team portraits
- structured value statements
- large conceptual headings

### Value list

Use numeric sequencing:

```text
01 Expertise
02 Confidence
03 Attitude
04 Integrity
05 Excellence
```

Each item gets a large number, big title and short body.

---

# 28. Services page design

The Services page positions the offering as “Global Supply Chain Coverage” and includes:

- international freight
- customs brokerage
- logistics
- domestic transport
- specialist project cargo
- technology-driven operations / visibility
- CargoWise
- MachShip
- detailed service modules

citeturn342926search1turn966152view1

## Layout

Use:

```text
hero
↓
technology / visibility statement
↓
platform feature blocks
↓
core services index
↓
large service detail sections
↓
final CTA
```

Each service detail block should be visually substantial:

- 40–60% image/visual
- 40–60% text
- oversized title
- small CTA

---

# 29. Industries page design

Route exists as `/industries` and belongs to the shared brand shell. Use the same:

- fixed header
- typography
- content grid
- editorial image treatment
- FAQ/final CTA/footer pattern

The live site exposes a dedicated Industries page with `500` lines in the rendered source.

Recommended information architecture:

```text
industry hero
↓
industry selector / categories
↓
industry feature stories
↓
common operational challenges
↓
service mapping
↓
proof / case studies
↓
CTA
```

---

# 30. Careers page design

The current Careers page is content-heavy but remains aligned to the same visual system.

Current sections include:

- “join our team” hero
- Work & Environment
- capability & character
- four behavioral principles
- employee benefits / expectations
- hiring process
- job filters and job list
- employee testimonials

citeturn229982search3

## Job filtering UI

Use compact technical controls rather than large SaaS cards:

- category select
- position select
- location select
- type select
- apply action

Selected filter state:

- black fill
- white text
- pill geometry

Unselected:

- white/light background
- dark text
- subtle 1px border

---

# 31. Community page design

Community contains sponsorship/community-impact content including:

- South East Melbourne Phoenix
- Keilor Thunder
- future partnership CTA
- community highlights
- charity/community partner cards

citeturn229982search5

## Art direction

This page can carry more human/sport photography than the freight pages, but the shell should remain:

- black/white foundation
- oversized typography
- minimal UI
- strong image crops
- simple CTA pills

---

# 32. Contact page design

Current Contact page includes:

- “Get in touch” hero
- hotline / working hours / LinkedIn / email
- appointment form
- reason-of-enquiry selector
- personal information fields
- message field
- locations across Melbourne, New Zealand, Hong Kong and China

citeturn229982search1

## Form styling

Form fields should feel editorial and premium rather than enterprise-admin:

```css
.field {
  position: relative;
  padding-block: 1.6rem;
  border-bottom: 0.1rem solid rgba(17,17,17,0.24);
}

.field-label {
  font-family: var(--font-ui-mono);
  font-size: 1.1rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field-input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-family: var(--font-body);
  font-size: 1.8rem;
}
```

Focus behavior:

- line transitions to darker/primary color
- avoid glowing rings unless accessibility requires a visible focus indicator
- error line uses `#df2020`

The source explicitly uses `#df2020` for active form error lines.

---

# 33. Images / art direction

## 33.1 Image categories observed

The site uses:

- aerial roads/highways
- shipping containers
- port machinery
- cranes
- cargo ships
- trucks/trailers
- warehouse/industrial details
- people/team photos
- office/team environments
- international trade/map/globe imagery

The current homepage source lists many isolated industrial cutouts and logistics photographs.

## 33.2 Image treatment

Preferred:

- cover crop
- edge-to-edge composition
- industrial close-ups
- high detail
- hard contrast
- directional lighting
- occasional cutout on white background

Avoid:

- generic “happy office team” stock photographs
- soft lifestyle photography as the primary asset
- over-rounded images
- excessive image overlays

## 33.3 Aspect-ratio defaults

Implementation tokens:

```css
--ratio-hero: 16 / 9;
--ratio-editorial: 4 / 3;
--ratio-card: 16 / 10;
--ratio-square: 1 / 1;
--ratio-portrait: 4 / 5;
```

Use source artwork dimensions rather than letterboxing where possible.

---

# 34. 3D / canvas / visualization system

## 34.1 Hero visualization

Use Three.js/WebGL or Canvas for a premium rebuild.

The public mirror confirms the site uses a custom Vite/Rolldown application with Three.js, GSAP, Barba.js, Lenis and Swiper, plus a custom cursor.

## 34.2 Global-network scene

Conceptual object model:

```ts
type NetworkPoint = {
  lat: number;
  lon: number;
  label: string;
  colorRole: "primary" | "accent";
};

type RouteArc = {
  from: NetworkPoint;
  to: NetworkPoint;
  progress: number;
};
```

Visual behavior:

- slow ambient rotation
- route arcs animate independently
- small markers pulse/fade
- blue illumination acts as the cool light source
- orange is the route/action accent
- keep labels sparse

## 34.3 Hero canvas layering

Recommended layer order:

```text
background black
↓
ambient blue glow
↓
globe/network geometry
↓
route arcs
↓
point markers
↓
hero text
↓
header
```

---

# 35. Scroll behavior

The site is fundamentally **scroll-led**.

Use:

- `position: sticky`
- viewport-height stages
- section pinning
- progress-based transforms
- subtle parallax
- controlled reveal

Avoid:

- scroll-jacking the page unless necessary
- long easing delays that make the page feel unresponsive
- animated text on every line of every paragraph

## Sticky-stage formula

For cinematic sections:

```css
.scene {
  position: relative;
  height: 350vh;
}

.scene__sticky {
  position: sticky;
  top: 0;
  height: 100vh;
}
```

This matches the documented service-stack implementation.

---

# 36. Motion tokens

```css
--motion-fast: 180ms;
--motion-ui: 300ms;
--motion-standard: 400ms;
--motion-slow: 550ms;
--motion-editorial: 600ms;
--motion-ambient: 1200ms;

--ease-standard: ease;
--ease-smooth: cubic-bezier(0.66, 0, 0.15, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-gsap-power1: cubic-bezier(0.25, 0.1, 0.25, 1);
```

Known source timings include:

- `0.4s` shared UI transitions
- `0.6s` hover/underline transitions
- `0.55s` holographic/card state transitions
- `22ms` navigation stagger
- `190ms` menu delay
- `170ms` cursor-glow in
- `520ms` cursor-glow out
- `7s` hero wave cadence / `6s` travel

citeturn752074view1turn966152view6turn276697view3turn966152view11

---

# 37. Custom cursor

Desktop-only enhancement.

The source includes a custom cursor with variants such as:

- standard dot/outline
- back control
- next control
- link cursor
- “book a call” cursor label

The source markup includes a circular progress outline and contextual text.

## Rules

- hide native cursor only after custom cursor is initialized
- never hide cursor on touch devices
- show a restrained outline/dot by default
- switch cursor content based on target semantics
- cursor animation should never block clicks

Recommended:

```css
@media (hover:hover) and (pointer:fine) {
  body.has-custom-cursor { cursor: none; }
}
```

---

# 38. Loading state

The original site uses a loader/intro system before the main experience.

For an agent-built reproduction:

### Preferred loader

- black background
- centered brand mark
- minimal progress/opacity change
- 0.8–1.2s maximum perceived wait
- never block navigation longer than necessary

### Avoid

- fake 5–10 second loaders
- percentage counters with no actual meaning
- spinning generic loaders

---

# 39. Text reveal system

The source uses masked line reveals and background-clip text treatments.

Shared pattern:

```css
.line-mask {
  overflow: hidden;
}

.line-inner {
  display: block;
  will-change: transform;
}
```

The hero implementation additionally paints text via a horizontal gradient and moves the gradient position to produce a reveal effect.

## Recommended new implementation

Use a reusable `RevealLine` component:

```tsx
<RevealLine delay={0}>Every</RevealLine>
<RevealLine delay={40}>leg of the journey</RevealLine>
```

Behavior:

- initial `transform: translateY(100%)`
- clip parent
- animate to `0`
- duration `600–800ms`
- stagger `40–80ms`

Do not animate individual characters unless a specific hero calls for it.

---

# 40. Accessibility rules

Even though the visual system is cinematic, the new app must remain accessible.

### Requirements

- WCAG-compliant text contrast
- keyboard navigation
- visible focus states
- semantic headings
- skip link
- reduced-motion mode
- alt text for meaningful images
- `aria-expanded` for accordions
- no information communicated by color alone
- interactive hit targets >= 44px on touch devices

The original visual design can be preserved without sacrificing accessibility.

---

# 41. Component inventory

Build these reusable primitives before implementing pages.

## Layout

```text
AppShell
Header
Container
Grid
Section
FullBleed
StickyScene
Footer
```

## Typography

```text
Eyebrow
DisplayTitle
SectionTitle
BodyText
MetaLabel
StatValue
StatLabel
```

## Actions

```text
PrimaryButton
SecondaryButton
TextLink
ArrowLink
MenuButton
```

## Content

```text
ServiceCard
FeatureItem
StatBlock
Testimonial
LogoStrip
ArticleCard
FaqItem
TeamCard
LocationCard
JobCard
```

## Motion

```text
RevealLine
RevealGroup
Marquee
ParallaxImage
StickyStack
CursorController
HeroNetworkScene
```

---

# 42. Component states

Every interactive component should define:

```text
rest
hover
focus
active
disabled
loading
error
mobile
reduced-motion
```

### Button state example

```css
rest      = high-contrast pill
hover     = small translate / arrow movement
focus     = visible outline
active    = slight scale(0.98)
disabled  = opacity 0.45; pointer-events:none
loading   = preserve width, replace text/icon
```

---

# 43. Page shells

## Marketing shell

Used by:

- `/`
- `/about`
- `/services`
- `/industries`
- `/careers`
- `/community`
- `/contact`
- `/insights`

```text
<AppShell>
  <Header />
  <main>
    page-specific sections
  </main>
  <Footer />
</AppShell>
```

## Editorial shell

Used by:

- `/insights`
- `/insights/:slug`

Includes:

- header
- editorial hero
- metadata
- article body
- related stories
- final CTA
- footer

---

# 44. Suggested CSS token file

```css
:root {
  /* ---------- color ---------- */
  --c-black: #000;
  --c-near-black: #0c1016;
  --c-black-text: #111;
  --c-white: #fff;
  --c-900: #1e1e1e;
  --c-800: #23272d;
  --c-700: #3a3e44;
  --c-600: #50555a;
  --c-500: #a5abad;
  --c-400: #d9d9d9;
  --c-300: #333;
  --c-accent: #f50;
  --c-link-hover: #0016cb;
  --c-error: #df2020;

  /* ---------- type ---------- */
  --font-display: "BT Steinhart", "Helvetica Neue", Arial, sans-serif;
  --font-body: "Helvetica Neue", Arial, sans-serif;
  --font-ui: "BT Steinhart Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --tracking-display: -0.045em;
  --tracking-heading: -0.03em;
  --tracking-ui: 0.04em;

  /* ---------- spacing ---------- */
  --s-1: 0.4rem;
  --s-2: 0.8rem;
  --s-3: 1.2rem;
  --s-4: 1.6rem;
  --s-5: 2rem;
  --s-6: 2.4rem;
  --s-7: 3.2rem;
  --s-8: 4rem;
  --s-9: 4.8rem;
  --s-10: 5.6rem;
  --s-11: 6.4rem;
  --s-12: 8rem;
  --s-13: 9.6rem;
  --s-14: 12.8rem;
  --s-15: 16rem;

  /* ---------- geometry ---------- */
  --radius-sm: 0.4rem;
  --radius-md: 0.6rem;
  --radius-lg: 2rem;
  --radius-xl: 3.2rem;
  --radius-2xl: 4.8rem;
  --radius-pill: 10vmin;
  --border-width: 0.1rem;

  /* ---------- layout ---------- */
  --page-gutter: 2.4rem;
  --grid-gap: 2rem;
  --grid-columns: 16;

  /* ---------- motion ---------- */
  --t-fast: 180ms;
  --t-standard: 400ms;
  --t-slow: 600ms;
  --ease-smooth: cubic-bezier(0.66, 0, 0.15, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (max-width: 991px) {
  :root {
    --page-gutter: 2rem;
    --grid-gap: 2rem;
    --grid-columns: 8;
  }
}

@media (max-width: 767px) {
  :root {
    --page-gutter: 2rem;
    --grid-gap: 1.6rem;
    --grid-columns: 4;
  }
}
```

---

# 45. Suggested Tailwind mapping

For Tailwind projects, create semantic CSS variables first, then map utilities to the tokens. Do not hard-code the values repeatedly in JSX.

Example:

```js
// tailwind.config.js / equivalent theme config
colors: {
  background: "var(--c-white)",
  foreground: "var(--c-black-text)",
  dark: "var(--c-black)",
  accent: "var(--c-accent)",
}
```

Then use semantic utilities such as:

```text
bg-background
text-foreground
bg-dark
text-white
text-accent
rounded-pill
```

---

# 46. React component contract for AI agents

The AI agent should not implement raw markup page-by-page. It should build a small design-system layer first.

## Example API

```tsx
<Section tone="dark" size="xl" scene>
  <Container>
    <Grid>
      ...
    </Grid>
  </Container>
</Section>
```

```tsx
<DisplayTitle align="center" maxWidth="12ch">
  Every leg of the journey
</DisplayTitle>
```

```tsx
<Button variant="primary" icon="arrow">
  Talk with us
</Button>
```

```tsx
<ServiceStack
  items={services}
  cards={4}
  sticky
  progressDriven
/>
```

```tsx
<ArticleCard
  image={image}
  category={category}
  date={date}
  title={title}
/>
```

---

# 47. Implementation architecture recommendation

For a new production app:

```text
src/
  design/
    tokens.css
    typography.css
    motion.css
    globals.css
  components/
    layout/
    navigation/
    typography/
    actions/
    cards/
    editorial/
    motion/
  scenes/
    HeroNetwork/
    ServiceStack/
    LogoMarquee/
  pages/
    Home/
    About/
    Services/
    Industries/
    Insights/
    Careers/
    Community/
    Contact/
  data/
    navigation.ts
    services.ts
    industries.ts
    insights.ts
```

Keep business/content data outside the visual components.

---

# 48. “Do not” rules for the AI agent

```text
DO NOT replace the visual system with generic Tailwind defaults.
DO NOT use Inter as the primary display font when reproducing the original brand.
DO NOT make every component rounded.
DO NOT use colored cards for every service.
DO NOT add drop shadows to every card.
DO NOT use a hero made of three stock photos.
DO NOT make the nav huge.
DO NOT turn desktop sticky scenes into scroll-jacking on mobile.
DO NOT animate every element simultaneously.
DO NOT use more than one strong accent color.
DO NOT invent new spacing values unless the existing token scale cannot express the layout.
DO NOT let page-specific margins break the global grid.
```

---

# 49. Performance rules

The original experience is visually ambitious; the new implementation should retain the feel without reproducing avoidable technical weight.

## Images

- use AVIF/WebP
- provide responsive `srcset`
- lazy-load below-fold images
- eager-load hero visual
- use poster images for video

## 3D

- dynamically import WebGL scene
- cap DPR
- pause animation when off-screen
- do not create multiple canvas instances across SPA navigation
- use reduced-motion fallback

## Motion

- prefer transform/opacity
- avoid layout animation for large scenes
- use requestAnimationFrame for a single scene loop
- use IntersectionObserver to activate/deactivate scenes

---

# 50. Responsive QA matrix

Before shipping, verify at minimum:

| Viewport | Expected |
|---|---|
| `1920×1080` | full desktop hierarchy, hero cinematic |
| `1728×900` | primary reference geometry |
| `1440×900` | centered/large hero, full navigation |
| `1280×800` | no broken nav spacing |
| `1024×768` | tablet/compact transition |
| `991×768` | tablet column system |
| `768×1024` | tablet/mobile header boundary |
| `393×852` | phone reference geometry |
| `375×812` | phone portrait |
| `320×568` | smallest supported phone |
| `667×375` | landscape short viewport |

The reverse-engineered source explicitly validates layouts at `1728`, `1440`, `992`, `991`, `768`, `393`, `320`, and a short landscape viewport.

---

# 51. Visual acceptance checklist

An AI-generated recreation is considered visually aligned only when:

### Global

- [ ] header stays aligned to the global grid
- [ ] logo/CTA remain stable on scroll
- [ ] black/white palette dominates
- [ ] accent is used sparingly
- [ ] headings have the geometric display character
- [ ] body copy feels light and editorial

### Hero

- [ ] title is oversized
- [ ] title is the first visual object read
- [ ] hero fills viewport
- [ ] network/cargo visualization provides depth
- [ ] CTAs remain secondary to the title
- [ ] header contrasts against the active background

### Content sections

- [ ] generous spacing
- [ ] strong image cropping
- [ ] large section headlines
- [ ] minimal borders
- [ ] no generic card-grid feel

### Motion

- [ ] motion is subtle before scroll
- [ ] sticky scenes feel deliberate
- [ ] hover transitions are 400–600ms
- [ ] no elastic/bouncy SaaS animation
- [ ] reduced-motion works

### Mobile

- [ ] no horizontal page drift
- [ ] menu is reachable
- [ ] title fits without accidental clipping
- [ ] CTA row stays usable
- [ ] sticky scenes flatten naturally where necessary

---

# 52. Known source facts that should remain in the implementation notes

1. The website is a **Webflow** build.  
2. The visual/runtime layer includes **Three.js, GSAP, Barba.js, Lenis and Swiper** in the captured build.  
3. The current live homepage is structured as a global logistics story: hero → positioning → stats → services → reliability → differentiators → proof/partners → insights → FAQ → CTA/footer.  
4. The navigation uses `992px` and `768px` responsive boundaries.  
5. The root sizing system is viewport-relative and approximately 10px/rem at reference widths.  
6. The services stack uses specific dark grays, large radii, very large display type, and sticky scroll behavior.  
7. The hero visual system uses a dark background and interactive network-style visualization; the public design capture shows the luminous globe/route treatment.

---

# 53. Outstanding exact-token verification

These items are the only places where this research should **not** be presented as a guaranteed literal source value:

- exact `--container--max-width` value from the minified Webflow stylesheet
- every underlying Webflow-generated color variable alias name
- every heading size on every internal page
- exact dimensions of each current live asset
- every hidden/commerce-only component token

The design system above intentionally converts the source into stable semantic tokens so an AI agent can implement the visual language without coupling the new app to Webflow's generated class names.

---

# 54. Recommended first implementation order

```text
1. tokens.css
2. font loading
3. Container + 16/8/4-column grid
4. Header + responsive menu
5. Button / link system
6. Hero typography + background canvas
7. Homepage section rhythm
8. Service stack
9. Reliability / differentiators
10. testimonials / logos
11. insights / FAQ
12. footer
13. internal page shells
14. 3D polish
15. custom cursor
16. reduced motion + accessibility
17. visual regression tests
```

The agent should only move to step `n+1` after step `n` passes a visual comparison at the reference viewports.

---

# 55. Reference sources

- Live homepage: https://unitedcarriers.com/
- Live About: https://unitedcarriers.com/about
- Live Services: https://unitedcarriers.com/services
- Live Industries: https://unitedcarriers.com/industries
- Live Insights: https://unitedcarriers.com/insights
- Live Careers: https://unitedcarriers.com/careers
- Live Community: https://unitedcarriers.com/community
- Live Contact: https://unitedcarriers.com/contact
- Public captured implementation/mirror used to inspect the same Webflow build: https://github.com/amndrd/harborview-partners

---

# 56. Final design summary for an AI coding agent

**Build the interface as a cinematic logistics editorial site, not a generic corporate website.**

The visual formula is:

```text
black / white
+
oversized geometric display type
+
mono uppercase micro-labels
+
large grid-aligned whitespace
+
industrial logistics imagery
+
luminous global-network visualization
+
pill CTAs
+
sticky scroll scenes
+
slow, controlled motion
+
very restrained UI chrome
```

The most important perceptual targets are **typography, spacing, grid alignment, image art direction, and hero atmosphere**. Perfectly reproducing a generated Webflow class name is irrelevant; reproducing the underlying visual system is the goal.
