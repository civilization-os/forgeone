---
name: ForgeOne Design System
colors:
  surface: '#f9f9f7'
  surface-dim: '#dadad8'
  surface-bright: '#f9f9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f2'
  surface-container: '#eeeeec'
  surface-container-high: '#e8e8e6'
  surface-container-highest: '#e2e3e1'
  on-surface: '#1a1c1b'
  on-surface-variant: '#46474a'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1ef'
  outline: '#76777b'
  outline-variant: '#c7c6ca'
  surface-tint: '#5f5e5f'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1c'
  on-primary-container: '#858384'
  inverse-primary: '#c8c6c7'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e1dfdf'
  on-secondary-container: '#626262'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1c1c'
  on-tertiary-container: '#838484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e3'
  primary-fixed-dim: '#c8c6c7'
  on-primary-fixed: '#1b1b1c'
  on-primary-fixed-variant: '#474647'
  secondary-fixed: '#e4e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#f9f9f7'
  on-background: '#1a1c1b'
  surface-variant: '#e2e3e1'
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  code-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '450'
    lineHeight: '1.6'
    letterSpacing: '0'
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 20px
  lg: 32px
  xl: 48px
  container-max: 1200px
  sidebar-width: 260px
---

## Brand & Style
The design system is built for a professional Agent Framework, prioritizing cognitive clarity and long-form interaction. The brand personality is **Intelligent, Stable, and Developer-Friendly**. 

The aesthetic adopts a **Refined Minimalism** approach. It avoids the harshness of high-contrast "stark" interfaces in favor of a "Soft-UI" philosophy. By utilizing off-white surfaces and low-contrast boundaries, the interface recedes to let the agent’s logic and the developer's code remain the focal point. The emotional response should be one of calm focus and systematic reliability, echoing the precision of modern engineering tools while maintaining the warmth of a high-end editorial experience.

## Colors
The palette is centered on a "Soft White" ecosystem to minimize ocular fatigue during extended development sessions. 

- **Primary Canvas:** Use `#F9F9F9` as the main application background.
- **Surface Elevation:** Pure `#FFFFFF` is reserved exclusively for elevated surfaces like code blocks, chat bubbles, or active modals to create a subtle lift.
- **Borders:** Use `#EBEBE8` for structural divisions. Borders should feel like "guides" rather than "walls."
- **Typography Colors:** The primary text is `#1A1A1B` (an off-black) to maintain readability without the vibration of pure black on white. Secondary metadata uses `#6B6B6B`.
- **Accents:** A single, intelligent blue (`#2D63ED`) is used sparingly for primary actions, success states, or active indicators.

## Typography
This design system utilizes **Inter** for all UI and prose elements due to its exceptional legibility and neutral, systematic character. For technical contexts—such as agent logs, terminal outputs, and code snippets—**Geist** is employed to provide a precise, developer-centric feel.

Typography is treated with a hierarchy that favors whitespace over font size. Headlines should be tight and impactful, while body text requires generous line heights (1.5–1.6x) to ensure the readability of complex technical instructions. Label styles use subtle tracking increases to maintain clarity at micro-scales.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model optimized for desktop productivity. 

- **Sidebar:** A fixed-width navigation and agent-selector area (260px) sits on the left, utilizing the `#F7F7F5` neutral background.
- **Main Canvas:** A fluid central area for chat and execution, constrained to a `1200px` max-width for optimal line length in long-form text.
- **Margins & Gutters:** A generous `20px` (md) standard gutter is used between major UI sections.
- **Rhythm:** Spacing follows a 4px baseline. Use `32px` (lg) padding for main container internal spacing to create the "airy" feel characteristic of high-end AI tools.

## Elevation & Depth
Depth in this design system is achieved through **Tonal Layering** rather than aggressive shadows. 

1. **Level 0 (Background):** `#F9F9F9` – The base application shell.
2. **Level 1 (Card/Surface):** `#FFFFFF` – Content containers with a 1px solid border of `#EBEBE8`.
3. **Level 2 (Active/Floating):** `#FFFFFF` – Modals or dropdowns. These use a "Soft Ambient Shadow": `0px 4px 20px rgba(0, 0, 0, 0.04)`.

The goal is a "flat-plus" aesthetic where elements appear to sit just millimeters above the surface, differentiated more by their color change than by their shadow depth.

## Shapes
The shape language is **Soft and Precise**. A standard radius of `4px` (0.25rem) is applied to buttons, input fields, and small UI components to maintain a professional, slightly architectural edge. Larger containers like chat bubbles or main cards may use `8px` to soften the overall composition of the page without feeling overly "bubbly" or consumer-grade.

## Components

- **Buttons:** 
  - *Primary:* Solid `#1A1A1B` with white text. 
  - *Secondary:* Ghost style with `#EBEBE8` border and `#1A1A1B` text. 
  - Padding: `8px 16px` for standard.
- **Input Fields:** Use a subtle `#F3F3F1` background with no border in the default state. Upon focus, transition to a `#FFFFFF` background with a 1px `#2D63ED` border.
- **Agent Chat Bubbles:** 
  - *User:* Minimalist text-only, right-aligned. 
  - *Agent:* `#FFFFFF` background with a 1px border and `16px` internal padding.
- **Chips/Badges:** Small, `4px` radius, using a very light gray (`#EDEDED`) background and `#6B6B6B` text for metadata tagging (e.g., "Python", "Success", "v1.2").
- **Lists:** Clean rows with `12px` vertical padding. Hover states should use a subtle color shift to `#F3F3F1` rather than a border change.
- **Code Blocks:** Use `#FDFDFD` background with Geist Mono. Include a subtle "Copy" button in the top-right that only appears on hover.