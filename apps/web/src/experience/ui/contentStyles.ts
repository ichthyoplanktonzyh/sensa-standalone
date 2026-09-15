/**
 * Semantic presentation bridge for content surfaces that still consume uiClass.
 *
 * Keep this layer free of palette literals. Components can be moved off the
 * bridge incrementally without losing curated-skin or color-mode support.
 */
const surface = "bg-surface-canvas! text-fg-primary!";
const card =
  "rounded-card! border! border-border-subtle! bg-surface-panel! [background-image:none]! p-6! shadow-none! text-fg-primary!";
const primary =
  "min-h-12! rounded-control! bg-action-primary! [background-image:none]! px-5! text-sm! text-action-on-primary! shadow-none! hover:bg-action-primary-hover!";

export const contentStyles: Record<string, string> = {
  "pmw-screen": `${surface} bg-overlay/50!`,
  "content-nav":
    "min-h-20! border-b! border-border-subtle! bg-surface-canvas! px-6! py-4! lg:px-10! [&_h1]:text-xl! [&_h1]:font-medium! [&_button]:min-h-11! [&_button]:min-w-11! [&_button]:text-fg-secondary!",
  "content-nav-back": "rounded-control! bg-transparent! text-fg-secondary!",
  "content-page-body": "mx-auto! w-full! max-w-4xl! px-6! py-8! sm:px-10! pb-12!",
  "sense-detail-hero":
    "rounded-none! bg-transparent! px-0! pt-4! pb-9! border-b! border-border-subtle! [background-image:none]! shadow-none!",
  "sense-detail-wordline":
    "[&_h2]:text-5xl! [&_h2]:font-medium! [&_h2]:text-fg-primary!",
  "sense-detail-meaning": "mt-5! text-xl! text-fg-secondary!",
  "sense-detail-section": "mt-8! bg-transparent! shadow-none!",
  "sense-example-card": card,
  "sense-note-card":
    "rounded-card! border! border-border-subtle! bg-surface-panel! p-5! text-fg-secondary!",
  "sense-note-icon": "bg-accent-soft! text-action-primary!",
  "sense-sibling-card":
    "rounded-control! border! border-border-subtle! bg-surface-panel! p-4!",
  "sense-detail-actions":
    "mt-8! gap-3! [&>button]:rounded-control! [&>button]:border! [&>button]:border-border-subtle! [&>button]:bg-surface-panel! [&>button]:text-fg-secondary!",
  "example-detail-stage":
    "bg-surface-subtle! [background-image:none]! text-fg-primary! rounded-none! px-6! py-12! [&_h2]:text-fg-primary! [&_p]:text-fg-secondary!",
  "example-detail-orb": "hidden!",
  "example-audio-button": primary,
  "example-detail-controls":
    "[&_button]:bg-surface-panel! [&_button]:border! [&_button]:border-border-subtle! [&_button]:text-fg-secondary!",
  "example-sense-link":
    "mx-6! rounded-card! border! border-border-subtle! bg-surface-panel! p-5!",
  "csd-hero": `${card} [&_h2]:text-fg-primary! [&_h2]:text-2xl! [&>small]:text-fg-tertiary! [&>p]:text-fg-tertiary!`,
  "csd-confirm-mark": "hidden!",
  "csd-section": `${card} mt-6!`,
  "csd-prototype-scene":
    "rounded-control! bg-surface-subtle! p-5! [&_dd]:text-fg-secondary!",
  "csd-next-step": `${card} mt-6!`,
  "csd-binding-list":
    "[&_article]:rounded-control! [&_article]:bg-surface-subtle! [&_article]:border-border-subtle!",
  "csd-primary": primary,
  "csd-fact-pill": "bg-accent-soft! text-fg-secondary!",
  "csd-identity-details": "mt-8! text-xs! text-fg-tertiary!",
  "ebs-hero":
    "bg-transparent! [background-image:none]! p-0! py-4! text-fg-primary! shadow-none! [&_h2]:text-fg-primary! [&_p]:text-fg-tertiary! [&_h2]:text-2xl!",
  "ebs-hero-mark": "hidden!",
  "ebs-section": `${card} mt-6!`,
  "ebs-stepper":
    "bg-transparent! [&_li]:text-fg-secondary! [&_.is-active]:text-action-primary!",
  "ebs-candidate":
    "rounded-card! border! border-border-subtle! bg-surface-panel! text-fg-primary! [&.is-selected]:border-border-strong! [&.is-selected]:bg-surface-selected! p-5!",
  "ebs-primary": primary,
  "ebs-choice":
    "rounded-control! border-border-subtle! bg-surface-panel! text-fg-secondary! [&.is-selected]:bg-surface-selected! [&.is-selected]:border-border-strong!",
  "ebs-field":
    "[&_input]:min-h-12! [&_input]:rounded-control! [&_input]:bg-surface-panel! [&_input]:border-border-strong! [&_select]:min-h-12! [&_select]:bg-surface-panel!",
  "pmw-shell":
    "flex-1! h-auto! min-h-0! bg-surface-canvas! px-6! py-4! sm:px-8! text-fg-primary!",
  "pmw-transcript": "gap-6! py-6! [scrollbar-width:thin]!",
  "pmw-message":
    "text-sm! leading-7! [&>div]:bg-transparent! [&>div]:text-fg-primary! [&.is-learner>div]:rounded-card! [&.is-learner>div]:bg-accent-soft! [&.is-learner_p]:text-fg-primary!",
  "pmw-avatar": "bg-accent-soft! text-action-primary!",
  "pmw-material":
    "max-h-56! shrink-0! overflow-y-auto! rounded-card! border! border-border-subtle! bg-surface-panel! p-5! [&_p]:text-fg-secondary!",
  "pmw-composer":
    "shrink-0! rounded-card! border! border-border-strong! bg-surface-panel! p-3! [&_textarea]:text-sm! [&_textarea]:text-fg-primary! [&_button]:bg-action-primary! [&_button]:text-action-on-primary!",
  "pmw-dock-bar":
    "shrink-0! gap-3! border-border-subtle! bg-transparent! py-3!",
  "pmw-dock-chip":
    "rounded-control! bg-accent-soft! text-fg-secondary! [&_small]:text-fg-secondary!",
  "pmw-dock-confirm": primary,
  "pmw-dock-organize": "min-h-11! text-sm! text-fg-secondary! bg-transparent!",
  "pmw-primary": primary,
  "pmw-preview-layer":
    "fixed! inset-0! z-[110]! items-stretch! justify-end! bg-overlay! p-0!",
  "pmw-preview-sheet":
    "h-full! max-h-full! w-full! max-w-xl! rounded-none! bg-surface-canvas! px-6! pt-5! [&>header]:mb-5! [&>header_h2]:text-xl! [&>header_button]:size-11!",
  "pmw-preview-body": "min-h-0! flex-1! overflow-y-auto! py-4!",
  "pmw-card": `${card} mb-4! [&_b]:text-base!`,
  "pmw-review-layer":
    "fixed! inset-0! z-[120]! items-stretch! justify-end! bg-overlay! p-0!",
  "pmw-review":
    "h-full! max-h-full! w-full! max-w-xl! rounded-none! bg-surface-canvas! px-6! pt-5! [&>header_button]:size-11!",
  "pmw-review-card": card,
  "pmw-review-body": "min-h-0! flex-1! overflow-y-auto! py-5!",
  "pmw-done":
    "mx-auto! max-w-xl! overflow-y-auto! py-10! [&_h2]:text-2xl! [&_h2]:text-fg-primary!",
  "pmw-done-mark": "bg-accent-soft! text-action-primary!",
  "pmw-done-facts":
    "[&_article]:rounded-card! [&_article]:bg-surface-panel! [&_article]:border! [&_article]:border-border-subtle! [&_article]:p-5!",
  "intake-layer":
    "fixed! inset-0! z-[120]! items-stretch! justify-end! bg-overlay! p-0!",
  "intake-drawer":
    "h-full! max-h-full! max-w-xl! rounded-none! bg-surface-canvas! p-0! text-fg-primary!",
  "intake-drawer__grip": "hidden!",
  "intake-drawer__head":
    "border-b! border-border-subtle! px-6! py-5! [&_small]:hidden! [&_h2]:text-xl! [&_button]:size-11! [&_button]:rounded-control! [&_button]:bg-transparent!",
  "intake-drawer__body": "min-h-0! flex-1! overflow-y-auto! p-6!",
  "intake-drawer__hint": "hidden!",
  "intake-card": `${card} mb-4!`,
  "intake-card__status": "bg-accent-soft! text-fg-secondary!",
  "intake-card__summary": "text-base! leading-7! text-fg-primary!",
  "intake-card__options":
    "[&_button]:min-h-12! [&_button]:rounded-control! [&_button]:border-border-subtle! [&_button]:bg-surface-subtle! [&_button]:text-fg-secondary!",
  "intake-card__summon": primary,
};
