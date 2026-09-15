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
  - section: components
    reason: Component anatomy and behavior are fixed in prose while skin-specific recipes remain executable code.
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

The Web shell owns stable navigation and application structure. Pages own information hierarchy; skins do not rearrange routes or replace page composition. Layout should keep the current task obvious, group related material through proximity, and allow learning content enough space to be read without competing panels.

Spacing is consumed by semantic roles such as control inset, card inset, inline gap, cluster gap, section gap, and page gutter. Responsive behavior belongs to the product component or page contract. A skin may make density adjustments only within approved bounds and may not hide actions or content at any viewport.

## Elevation & Depth

Depth is primarily communicated through surface tone, borders, and clear containment. Shadows are supporting cues for overlays and genuinely raised controls, not a default decoration on every card. A skin may alter shadow softness and contrast while preserving the same stacking, modality, focus, and dismissal behavior.

## Shapes

Shape is semantic: controls, fields, cards, overlays, and pill-like selections use distinct roles. A skin may make those roles quieter or crisper, but it must map every role consistently and preserve hit targets, focus outlines, content fit, and control recognition.

## Components

Components have stable anatomy, behavior, state, and accessibility semantics. Skins provide visual recipes only.

- **Button and IconButton:** preserve label, icon meaning, disabled/loading behavior, focus, hit target, and primary/secondary hierarchy.
- **Input, Textarea, Search, and Choice controls:** preserve labels, help and error relationships, keyboard behavior, entered values, and validation state.
- **Navigation, Tabs, Dialog, Sheet, Toast, and Popover:** preserve destination, selection, focus management, dismissal, and announcement behavior.
- **Sense, Expression, Context, Learning Target, Book, Package, Scene, and Review components:** preserve the domain object's identity and field order. Presentation cannot manufacture learning evidence, outcomes, schedules, or successful sync state.
- **Learning runtime:** preserve the stage protocol, prompt, response affordance, reveal, rating choices, feedback, progress, and completion semantics. A skin cannot turn a different workflow into the same named stage.

A component must expose meaningful semantic slots and states. New component styling belongs in the shared primitive or domain component; page-local color and radius literals are not a supported extension mechanism.

The former `uiClass` recipe runtime has been retired. Stable layout and state selectors now live in their owning component or a scoped semantic stylesheet, and the appearance smoke rejects any return to the registry pattern. New product surfaces must not add recipe registries, private page palettes, or behavioral branches keyed to a skin.

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
