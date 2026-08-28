import type { ReactElement } from "react";

/** The prototype's icon set, kept as one table so the shapes stay comparable. */
const paths = {
  back: "M15 18l-6-6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  book: "M4 5.5A2.5 2.5 0 016.5 3H11v16H6.5A2.5 2.5 0 004 21V5.5zM20 5.5A2.5 2.5 0 0017.5 3H13v16h4.5A2.5 2.5 0 0120 21V5.5z",
  layers: "M12 3L3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
  chart: "M4 19V9M10 19V5M16 19v-7M22 19V3",
  user: "M20 21a8 8 0 00-16 0M12 13a5 5 0 100-10 5 5 0 000 10z",
  volume: "M11 5L6 9H3v6h3l5 4V5zM15 9a4 4 0 010 6M18 6a8 8 0 010 12",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  arrow: "M9 18l6-6-6-6",
  check: "M5 12l4 4L19 6",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6",
  play: "M8 5l11 7-11 7V5z",
  pause: "M8 5v14M16 5v14",
  expand: "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5",
  chevron: "M6 9l6 6 6-6",
  heart: "M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6",
} as const;

export type SensaIconName = keyof typeof paths;

export function Icon({ name, label }: Readonly<{ name: SensaIconName; label?: string }>): ReactElement {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      role={label === undefined ? "presentation" : "img"}
      aria-label={label}
      aria-hidden={label === undefined}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function IconButton(props: Readonly<{
  name: SensaIconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}>): ReactElement {
  return (
    <button
      type="button"
      className={`icon-button${props.active === true ? " active" : ""}${props.className === undefined ? "" : ` ${props.className}`}`}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.name} />
    </button>
  );
}
