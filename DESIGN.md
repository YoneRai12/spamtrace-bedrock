# SpamTrace Design System

Based on `VoltAgent/awesome-design-md`:
- Source: `design-md/voltagent/DESIGN.md`
- Intent: adapt the VoltAgent terminal-native developer aesthetic for a live moderation dashboard

## 1. Visual Theme & Atmosphere

SpamTrace should feel like a powered-on moderation console, not a generic SaaS admin screen.

- Dark-mode native, near-black canvas
- Emerald green is the only decorative accent
- UI should feel precise, dense, and technical
- Information hierarchy should come from layout, borders, and typography, not heavy gradients or oversized shadows
- Live data areas should feel like a terminal and monitoring surface

## 2. Color Palette & Roles

### Core
- **Abyss Black** `#050507`: page background
- **Carbon Surface** `#101010`: panels, cards, controls
- **Raised Surface** `#17191c`: secondary surfaces and grouped areas
- **Warm Border** `#3d3a39`: default containment line

### Text
- **Primary Text** `#f2f2f2`
- **Secondary Text** `#b8b3b0`
- **Dim Text** `#8b949e`

### Accent
- **Signal Green** `#00d992`: active border, status highlight, current signal
- **Mint Text** `#2fd6a1`: accent text on dark surfaces
- **Accent Faint** `rgba(0, 217, 146, 0.12)`: subtle filled badges and active chips
- **Accent Border** `rgba(0, 217, 146, 0.32)`: accent outline

### Semantic
- **Warning Amber** `#ffba00`
- **Warning Faint** `rgba(255, 186, 0, 0.12)`
- **Danger Coral** `#fb565b`
- **Danger Faint** `rgba(251, 86, 91, 0.12)`

## 3. Typography Rules

### Fonts
- **Headings**: `system-ui`
- **Body/UI**: `Inter`, fallback to system sans
- **Code / labels / metadata**: `SFMono-Regular`, `Consolas`, `Menlo`, monospace

### Hierarchy
- Hero title: large, compressed, `line-height: 1.0-1.05`, slight negative tracking
- Section headings: clean, dense, no oversized decorative styling
- Labels and overlines: monospace, uppercase, expanded letter spacing
- Metadata and log details: monospace

## 4. Component Stylings

### Buttons
- Default: dark surface, warm border, white text
- Primary: dark surface, green outline, mint text
- Danger: dark surface, coral outline, soft red text
- Radius: `8px`

### Panels and Cards
- Background: carbon black surfaces
- Border: always visible, no borderless floating glass cards
- Radius: `10px-14px`
- Shadows: minimal to none

### Badges and Chips
- Use pill badges for statuses, scores, and signal counts
- Favor outlined or faint-filled chips over large solid pills
- Monospace is preferred for event labels and metric chips

### Live Log
- Compact stacked event rows
- Left accent rule communicates state
- Timestamp and source path should be clearly visible but secondary

### Player Cards
- Name and status at the top
- Signals in one scan-friendly row
- Metadata in compact two-column blocks
- Action buttons grouped tightly and never oversized

## 5. Layout Principles

- Full-width shell that uses large desktop screens well
- FHD: main content left, live log / network rail right
- 4K: expand cards and player grid; do not simply enlarge padding
- Keep section spacing generous between blocks, but dense inside blocks
- Prefer 2-column player grid on wide desktop, 3-column on very wide screens

## 6. Depth & Elevation

- Use border contrast for depth first
- Active/important surfaces can switch border color to green
- Avoid soft frosted-glass styling
- Avoid heavy ambient glows except very subtle accent haze in hero/background

## 7. Do's and Don'ts

### Do
- Keep the UI dark, restrained, and technical
- Use emerald green sparingly and intentionally
- Use monospace for labels, prompts, timestamps, and operational detail
- Let monitoring areas feel dense and useful
- Keep buttons compact

### Don't
- Don't use orange or purple as the main accent
- Don't use oversized rounded "bubble" buttons
- Don't rely on heavy drop shadows or glassmorphism
- Don't make cards airy and empty
- Don't hide operational detail behind decorative whitespace

## 8. Responsive Behavior

- Mobile: single column
- Tablet: stacked sections with dense cards
- Desktop: left main / right rail
- Wide desktop: 2-column player grid
- Very wide desktop: 3-column player grid and wider log rail

## 9. Agent Prompt Guide

- "Make it feel like a terminal-native moderation console."
- "Use near-black surfaces, warm charcoal borders, and emerald as the only accent."
- "Prefer density, monospace labels, and compact operational controls over decorative marketing layouts."
- "Player cards should scan like incident cards, not profile cards."
