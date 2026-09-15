---
version: alpha
name: Sensa Web Design System
description: Stable semantic interface rules shared by Sensa's first-party, curated skins.
colors:
  primary: "{colors.accent}"
  paper: "#F8F9F5"
  ink: "#243E36"
  muted: "#63756C"
  line: "#DFE7DF"
  accent: "#28694F"
  sage: "#EDF2E8"
  clay: "#B56A42"
typography:
  sans:
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  editorial:
    fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif'
omitted:
  - section: spacing
    reason: The executable semantic contract owns spacing roles; a numeric product-wide scale has not yet been approved.
  - section: rounded
    reason: Shape values vary by curated skin and are exposed through semantic component roles.
---

# Sensa Web Design System

## Overview

Sensa should feel calm, attentive, and precise: a learning environment that keeps the learner focused on meaning rather than on interface chrome. Visual hierarchy must clarify the relationship among an expression, its sense, supporting language, context, and learning state without making the product feel like a dense administration dashboard.

This document defines the stable product-level design contract. Sensa ships a reviewed catalog of first-party skins; it is not a marketplace or an arbitrary runtime extension point. A skin may change presentation, but it must never change navigation, content, available actions, accepted input, learning facts, scheduling, persistence, or sync behavior.

The semantic contract is the boundary between product UI and a skin. Product components consume roles such as canvas, panel, primary text, secondary text, primary action, selection, focus, and feedback. They do not depend on a skin's palette names or hard-coded visual values.

The initial catalog contains two deliberately distinct adapters:

- **Sensa Quiet:** warm paper, deep green ink, sage support surfaces, and restrained clay accents. It is the calm editorial default and is grounded in the named palette above.
- **Sensa Clear:** a cooler, crisper product skin with higher visual separation and reduced decorative warmth. It must implement the same semantic roles and component states as Quiet.

Both skins must support light and dark color modes. Skin, color mode, and text size are independent device preferences. Changing any of them applies immediately without remounting the application or losing route, draft, selection, scroll, or learning-runtime state.

## Colors

The named palette in the frontmatter is the approved foundation for Sensa Quiet. Paper is the quiet canvas, ink is the core reading color, muted supports secondary information, line separates without dominating, accent identifies primary interaction, sage provides gentle grouping and selection, and clay is a sparse warm signal.

Runtime components must consume semantic color roles rather than these palette names. Each shipped skin provides a complete mapping for canvas, subtle and raised surfaces, selected surfaces, the always-dark media stage and its on-media foreground, primary/secondary/tertiary/inverse text, subtle/strong borders, primary action and hover, focus, selection, overlay, and success/warning/danger feedback.

The media stage is a paired semantic exception: `surface-media` remains dark in every color mode and `fg-on-media` remains light. It is reserved for provider video, unavailable-media placeholders, and controls rendered directly over that stage; ordinary panels and inverse actions must not reuse it.

Every mapping must remain legible in both light and dark modes. Color may reinforce status or selection, but it cannot be their only signal; text, iconography, shape, or position must carry the same meaning. System accessibility preferences take priority over skin decoration.

## Typography

The sans family is the dependable product face for navigation, controls, metadata, and continuous UI reading. The editorial family is an optional, purposeful voice for language material and reflective moments; it is not a decorative substitute for hierarchy.

Typography is expressed through semantic roles rather than page-local font sizes. At minimum, the product distinguishes display, page title, section title, body, supporting body, control label, metadata, learning expression, learning sense, and support-language text. Expression, sense, and support language must remain visually distinguishable without relying only on color.

Skins may adjust the font family, weight, tracking, and measured scale behind a role, but cannot collapse the role hierarchy or reduce readability. User text-size preference and browser zoom must compose with the skin instead of being overridden by it.

## Layout

The Web shell owns Product Semantics: stable routes, capability and region existence, business flow, data, events, disclosure, logical DOM/focus order, and accessibility behavior. A versioned Page Semantic Contract exposes those regions to the Page Layout Contract. Skins may arrange the same regions into columns, sidebars, docks, overlays-in-place, or other responsive spatial compositions, but cannot replace the page renderer, alter route identity, or add, remove, duplicate, reinterpret, or reorder regions semantically.

Spatial layout and responsive presentation belong to the Skin adapter behind that contract. Spacing is consumed by semantic roles such as control inset, card inset, inline gap, cluster gap, section gap, and page gutter. A Skin may change topology and density only within approved bounds and may not hide actions or content, make visual and keyboard order disagree, obscure sticky controls, or lose safe-area accommodation at any viewport.

An overlay-like presentation remains the same page only when route, browser history, deep-link, focus management, dismissal and data behavior are unchanged. If those semantics differ, the Product Shell must model the change; a Skin cannot create it through presentation code.

The executable `sensa-page-layout-v1` contract starts with the `learning-runtime` family. Product Shell always provides `header`, `tools`, `progress`, and `primary` in that logical DOM order, then may provide `supporting`, `feedback`, and `controls` when product state calls for them. `SensaPageLayout` renders this one semantic tree. Quiet arranges it as a centered reading flow; Clear uses a wide-screen sidebar and supporting column while returning to a linear topology at narrow widths. Both adapters implement the same layout tokens and neither can supply executable page code.

The `application-shell` family exposes one logical `brand`, `navigation`, `utilities`, and `viewport` tree. The viewport is invariant; Product Shell omits the three chrome regions during a focused learning flow without remounting the viewport or screen stack. On wide screens Quiet arranges the chrome as a horizontal top bar while Clear uses a vertical sidebar. At narrow widths both adapt the same navigation DOM to a touch-sized bottom bar, retain the top brand and utilities, and honor safe-area insets. Route selection, available sections, focus restoration, and screen visibility remain WebShell behavior rather than Skin behavior.

The `workspace-page` family provides the ordinary scrollable frame used by Today, Learning overview, and Account & Settings. Product code supplies `header` followed by `primary`; a reviewed `narrow`, `standard`, or `wide` measure hint describes content needs without prescribing pixels. Each Skin adapter resolves that hint into its own page measure, responsive gutters, block insets, and header rhythm. Screen state, headings, controls, status messages, and internal domain composition remain in the product-owned regions.

## Elevation & Depth

Depth is primarily communicated through surface tone, borders, and clear containment. Shadows are supporting cues for overlays and genuinely raised controls, not a default decoration on every card. A skin may alter shadow softness and contrast while preserving the same stacking, modality, focus, and dismissal behavior.

## Shapes

Shape is semantic: controls, fields, cards, overlays, and pill-like selections use distinct roles. A skin may make those roles quieter or crisper, but it must map every role consistently and preserve hit targets, focus outlines, content fit, and control recognition.

## Components

Components have stable anatomy, behavior, state, and accessibility semantics. Skins provide visual recipes only.

The executable `sensa-component-skin-v1` contract exposes eight component families: `action`, `field`, `surface`, `selection`, `overlay`, `feedback`, `navigation`, and `learning`. A product component declares only its family, approved variant, semantic slots, and state. Shared component CSS maps that stable anatomy to `--sensa-component-*` tokens; Quiet and Clear independently implement every token. Product code must never ask which Skin is active in order to select markup, copy, data, or behavior.

The first reusable React boundary includes `SensaAction`, `SensaChoice`, `SensaField`, `SensaSurface`, `SensaFeedback`, `SensaNavigation`, `SensaOverlayFrame`, and `SensaLearningSurface`. Their data attributes are an internal styling protocol, not a public third-party extension API. Domain components may compose these primitives or expose the same contract directly when their anatomy is richer.

- **Button and IconButton:** preserve label, icon meaning, disabled/loading behavior, focus, hit target, and primary/secondary hierarchy.
- **Input, Textarea, Search, and Choice controls:** preserve labels, help and error relationships, keyboard behavior, entered values, and validation state.
- **Navigation, Tabs, Dialog, Sheet, Toast, and Popover:** preserve destination, selection, focus management, dismissal, and announcement behavior.
- **Sense, Expression, Context, Learning Target, Book, Package, Scene, and Review components:** preserve the domain object's identity and field order. Presentation cannot manufacture learning evidence, outcomes, schedules, or successful sync state.
- **Learning runtime:** preserve the stage protocol, prompt, response affordance, reveal, rating choices, feedback, progress, and completion semantics. A skin cannot turn a different workflow into the same named stage.

A component must expose meaningful semantic slots and states. New component styling belongs in the shared primitive or domain component; page-local color and radius literals are not a supported extension mechanism.

Each curated adapter is a versioned build-time manifest. It declares compatibility with the semantic, component, and page-layout contracts plus reviewed capabilities for light/dark modes, text sizes, density, motion character, icon set, and implemented layout families. The static registry is the only shipped catalog; there is no URL, package name, or executable-code field that could become an unreviewed runtime loader.

The former `uiClass` recipe runtime has been retired. Stable layout and state selectors now live in their owning component or a scoped semantic stylesheet, and the appearance smoke rejects any return to the registry pattern. New product surfaces must not add recipe registries, private page palettes, or behavioral branches keyed to a skin.

In development, `/?skin-lab=1` opens the data-free Skin Lab instead of the product router. It renders every contracted component family/variant and page-layout family with explicit fixture copy. Browser validation runs the Lab across every shipped Skin, light/dark mode, standard/large text, and mobile/desktop widths; it also checks semantic-region identity and order, state preservation, token resolution, minimum control targets, keyboard focus, overflow, and runtime errors. The Lab is gated by `import.meta.env.DEV` and is not a production route.

## Do's and Don'ts

- Do build components against semantic tokens and verify them in every shipped skin, both color modes, supported text sizes, and relevant responsive widths.
- Do keep focus visible, status understandable without color, contrast at least WCAG AA for normal text, and motion compatible with reduced-motion preferences.
- Do treat Quiet and Clear as two adapters of one product contract; a feature must work identically after switching between them.
- Do keep each migrated product surface covered by the appearance smoke as its presentation evolves.
- Do fall back to the default skin and mode when a stored preference is missing, invalid, or no longer shipped.
- Don't hard-code palette values inside product components or couple behavior to a skin identifier.
- Don't let a skin replace routes, component anatomy, learning stages, data fields, event meaning, persistence, or network behavior.
- Don't load arbitrary third-party skin code at runtime. Only reviewed, versioned, first-party packages may enter the shipped catalog.
- Don't ship a skin with missing semantic roles, incomplete interaction states, or unsupported surfaces.
