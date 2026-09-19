/**
 * Stable layout primitives shared by first-party Web surfaces.
 *
 * These classes describe product structure and interaction states. Appearance
 * is supplied exclusively through the semantic Tailwind roles backed by the
 * active curated skin.
 */
export const iconClass = "inline-block size-5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]";

/**
 * Joins stable, component-owned selectors without consulting a skin recipe
 * registry. Hash-prefixed migration anchors are intentionally discarded.
 */
export const classNames = (...inputs: (string | undefined | null | false)[]): string =>
  inputs
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(token => token && !token.startsWith('#'))
    .join(' ');

export const contentNavigationClass =
  "sticky top-0 z-10 grid min-h-20 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3 border-b border-border-subtle bg-surface-canvas/95 px-6 py-4 backdrop-blur lg:px-10 [&_h1]:text-center [&_h1]:text-section-title [&_h1]:font-medium";

export const contentNavigationBackClass =
  "grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";

const screenBaseClass =
  "screen sensa-motion-screen absolute inset-0 h-full w-full overflow-x-hidden overflow-y-auto bg-surface-canvas font-product text-fg-primary [scrollbar-width:thin] focus-visible:outline-focus";

export const slideScreenClass = (active: boolean, layer = "z-[27]"): string =>
  `${screenBaseClass} sensa-motion-screen-slide ${layer} ${active ? "active visible pointer-events-auto translate-x-0" : "invisible pointer-events-none translate-x-full"}`;

export const fadeScreenClass = (active: boolean, layer = "z-10"): string =>
  `${screenBaseClass} sensa-motion-screen-fade ${layer} ${active ? "active visible pointer-events-auto opacity-100" : "invisible pointer-events-none opacity-0"}`;
