/** Content workspace presentation. All values are Tailwind utilities. */
const surface =
  "bg-[#fbfbfa]! text-[#222631]! [--content-ink:#222631] [--content-muted:#788194] [--content-line:#e1e5ed] [--content-bg:#fbfbfa]";
const card =
  "rounded-xl! border! border-[#e1e5ed]! bg-white! [background-image:none]! p-6! shadow-none! text-[#222631]!";
const primary =
  "min-h-12! rounded-lg! bg-[#2f3b70]! [background-image:none]! px-5! text-sm! text-white! shadow-none!";
export const contentStyles: Record<string, string> = {
  'personal-note-backdrop': 'fixed! inset-0! z-[120]! items-stretch! justify-end! bg-[#253047]/20! p-0!',
  'personal-note-sheet': 'h-full! max-h-full! max-w-xl! rounded-none! bg-[#fbfbfa]! text-[#222631]! p-6! sm:p-8! [background-image:none]! shadow-xl!',
  'personal-note-header': 'pb-5! border-b! border-[#e1e5ed]! [&_h2]:text-xl! [&_h2]:font-medium! [&_button]:size-11! [&_button]:rounded-lg! [&_button]:bg-[#edf0f7]! [&_button]:text-[#64718d]!',
  'personal-note-sense': 'py-6! [&_strong]:text-3xl! [&_strong]:text-[#222631]! [&_span]:text-[#788194]!',
  'personal-note-canvas': 'bg-white! rounded-xl! border! border-[#e1e5ed]! p-5! [&_textarea]:bg-transparent! [&_textarea]:text-base! [&_textarea]:leading-8! [&_textarea]:min-h-56! [&_label]:text-[#788194]!',

  "content-subscreen": surface,
  "pmw-screen": `${surface} bg-[#253047]/15!`,
  "content-nav":
    "min-h-20! border-b! border-[#e1e5ed]! bg-[#fbfbfa]! px-6! py-4! lg:px-10! [&_h1]:text-xl! [&_h1]:font-medium! [&_button]:min-h-11! [&_button]:min-w-11! [&_button]:text-[#64718d]!",
  "content-nav-back": "rounded-lg! bg-transparent! text-[#64718d]!",
  "content-page-body":
    "mx-auto! w-full! max-w-4xl! px-6! py-8! sm:px-10! pb-12!",
  "content-page-intro": "hidden!",
  "content-list-card":
    "rounded-none! border-x-0! border-[#e1e5ed]! bg-transparent! shadow-none!",
  "content-list-item":
    "min-h-24! border-[#e1e5ed]! bg-transparent! px-2! py-6! hover:bg-[#f2f4f8]! [&_.content-list-title]:text-lg! [&_.content-list-subtitle]:text-sm!",
  "content-word-mark": "size-10! rounded-lg! bg-[#edf0f7]! text-[#667596]!",
  "content-search":
    "mb-7! min-h-12! rounded-lg! border! border-[#e1e5ed]! bg-white! [&_input]:text-sm!",
  "content-empty":
    "bg-transparent! py-16! [&_h3]:text-base! [&_h3]:font-medium! [&_p]:text-[#798295]!",
  "content-empty-icon": "bg-[#edf0f7]! text-[#667596]!",
  "sense-detail-hero":
    "rounded-none! bg-transparent! px-0! pt-4! pb-9! border-b! border-[#e1e5ed]! [background-image:none]! shadow-none!",
  "sense-detail-wordline":
    "[&_h2]:text-5xl! [&_h2]:font-medium! [&_h2]:text-[#222631]!",
  "sense-detail-meaning": "mt-5! text-xl! text-[#64718d]!",
  "sense-detail-section": "mt-8! bg-transparent! shadow-none!",
  "sense-example-card": card,
  "sense-note-card":
    "rounded-xl! border! border-[#e1e5ed]! bg-white! p-5! text-[#64718d]!",
  "sense-note-icon": "bg-[#edf0f7]! text-[#667596]!",
  "sense-sibling-card": "rounded-lg! border! border-[#e1e5ed]! bg-white! p-4!",
  "sense-detail-actions":
    "mt-8! gap-3! [&>button]:rounded-xl! [&>button]:border! [&>button]:border-[#e1e5ed]! [&>button]:bg-white! [&>button]:text-[#64718d]!",
  "example-detail-stage":
    "bg-[#f2f4f8]! [background-image:none]! text-[#222631]! rounded-none! px-6! py-12! [&_h2]:text-[#222631]! [&_p]:text-[#64718d]!",
  "example-detail-orb": "hidden!",
  "example-audio-button": primary,
  "example-detail-controls":
    "[&_button]:bg-white! [&_button]:border! [&_button]:border-[#e1e5ed]! [&_button]:text-[#64718d]!",
  "example-sense-link":
    "mx-6! rounded-xl! border! border-[#e1e5ed]! bg-white! p-5!",
  "csd-hero": `${card} [&_h2]:text-[#222631]! [&_h2]:text-2xl! [&>small]:text-[#75809a]! [&>p]:text-[#75809a]!`,
  "csd-confirm-mark": "hidden!",
  "csd-section": `${card} mt-6!`,
  "csd-prototype-scene":
    "rounded-lg! bg-[#f4f6fa]! p-5! [&_dd]:text-[#64718d]!",
  "csd-next-step": `${card} mt-6!`,
  "csd-binding-list":
    "[&_article]:rounded-lg! [&_article]:bg-[#f4f6fa]! [&_article]:border-[#e1e5ed]!",
  "csd-primary": primary,
  "csd-fact-pill": "bg-[#edf0f7]! text-[#64718d]!",
  "csd-identity-details": "mt-8! text-xs! text-[#798295]!",
  "ebs-hero":
    "bg-transparent! [background-image:none]! p-0! py-4! text-[#222631]! shadow-none! [&_h2]:text-[#222631]! [&_p]:text-[#788194]! [&_h2]:text-2xl!",
  "ebs-hero-mark": "hidden!",
  "ebs-section": `${card} mt-6!`,
  "ebs-stepper":
    "bg-transparent! [&_li]:text-[#73809b]! [&_.is-active]:text-[#344779]!",
  "ebs-candidate":
    "rounded-xl! border! border-[#e1e5ed]! bg-white! text-[#222631]! [&.is-selected]:border-[#7d8fb8]! [&.is-selected]:bg-[#f1f3f9]! p-5!",
  "ebs-primary": primary,
  "ebs-choice":
    "rounded-lg! border-[#e1e5ed]! bg-white! text-[#64718d]! [&.is-selected]:bg-[#edf0f7]! [&.is-selected]:border-[#7d8fb8]!",
  "ebs-field":
    "[&_input]:min-h-12! [&_input]:rounded-lg! [&_input]:bg-white! [&_input]:border-[#d8dfeb]! [&_select]:min-h-12! [&_select]:bg-white!",
  "pmw-shell":
    "flex-1! h-auto! min-h-0! bg-[#fbfbfa]! px-6! py-4! sm:px-8! text-[#222631]!",
  "pmw-transcript": "gap-6! py-6! [scrollbar-width:thin]!",
  "pmw-message":
    "text-sm! leading-7! [&>div]:bg-transparent! [&>div]:text-[#313b50]! [&.is-user>div]:rounded-xl! [&.is-user>div]:bg-[#edf0f7]!",
  "pmw-avatar": "bg-[#e7ebf5]! text-[#5b6b94]!",
  "pmw-material":
    "max-h-56! shrink-0! overflow-y-auto! rounded-xl! border! border-[#e1e5ed]! bg-white! p-5! [&_p]:text-[#64718d]!",
  "pmw-composer":
    "shrink-0! rounded-xl! border! border-[#d5ddeb]! bg-white! p-3! [&_textarea]:text-sm! [&_textarea]:text-[#222631]! [&_button]:bg-[#2f3b70]! [&_button]:text-white!",
  "pmw-dock-bar": "shrink-0! gap-3! border-[#e1e5ed]! bg-transparent! py-3!",
  "pmw-dock-chip":
    "rounded-lg! bg-[#eef1f7]! text-[#64718d]! [&_small]:text-[#64718d]!",
  "pmw-dock-confirm": primary,
  "pmw-dock-organize": "min-h-11! text-sm! text-[#65718b]! bg-transparent!",
  "pmw-primary": primary,
  "pmw-preview-layer":
    "fixed! inset-0! z-[110]! items-stretch! justify-end! bg-[#253047]/20! p-0!",
  "pmw-preview-sheet":
    "h-full! max-h-full! w-full! max-w-xl! rounded-none! bg-[#fbfbfa]! px-6! pt-5! [&>header]:mb-5! [&>header_h2]:text-xl! [&>header_button]:size-11!",
  "pmw-preview-body": "min-h-0! flex-1! overflow-y-auto! py-4!",
  "pmw-card": `${card} mb-4! [&_b]:text-base!`,
  "pmw-review-layer":
    "fixed! inset-0! z-[120]! items-stretch! justify-end! bg-[#253047]/20! p-0!",
  "pmw-review":
    "h-full! max-h-full! w-full! max-w-xl! rounded-none! bg-[#fbfbfa]! px-6! pt-5! [&>header_button]:size-11!",
  "pmw-review-card": card,
  "pmw-review-body": "min-h-0! flex-1! overflow-y-auto! py-5!",
  "pmw-done":
    "mx-auto! max-w-xl! overflow-y-auto! py-10! [&_h2]:text-2xl! [&_h2]:text-[#222631]!",
  "pmw-done-mark": "bg-[#e7ebf5]! text-[#5b6b94]!",
  "pmw-done-facts":
    "[&_article]:rounded-xl! [&_article]:bg-white! [&_article]:border! [&_article]:border-[#e1e5ed]! [&_article]:p-5!",
  "intake-layer":
    "fixed! inset-0! z-[120]! items-stretch! justify-end! bg-[#253047]/20! p-0!",
  "intake-drawer":
    "h-full! max-h-full! max-w-xl! rounded-none! bg-[#fbfbfa]! p-0! text-[#222631]!",
  "intake-drawer__grip": "hidden!",
  "intake-drawer__head":
    "border-b! border-[#e1e5ed]! px-6! py-5! [&_small]:hidden! [&_h2]:text-xl! [&_button]:size-11! [&_button]:rounded-lg! [&_button]:bg-transparent!",
  "intake-drawer__body": "min-h-0! flex-1! overflow-y-auto! p-6!",
  "intake-drawer__hint": "hidden!",
  "intake-card": `${card} mb-4!`,
  "intake-card__status": "bg-[#edf0f7]! text-[#64718d]!",
  "intake-card__summary": "text-base! leading-7! text-[#313b50]!",
  "intake-card__options":
    "[&_button]:min-h-12! [&_button]:rounded-lg! [&_button]:border-[#e1e5ed]! [&_button]:bg-[#f3f5f9]! [&_button]:text-[#64718d]!",
  "intake-card__summon": primary,
};
