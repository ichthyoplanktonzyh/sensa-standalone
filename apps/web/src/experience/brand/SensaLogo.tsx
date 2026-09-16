import type { HTMLAttributes } from "react";
import { classNames } from "../ui/primitives";

export type SensaLogoProps = Omit<HTMLAttributes<HTMLSpanElement>, "children">;

/** Fixed Sensa identity artwork. Color mode selects an exported tone; Skins do not redraw it. */
export function SensaLogo({ className, ...props }: SensaLogoProps) {
  return (
    <span
      {...props}
      data-sensa-brand-logo
      aria-hidden="true"
      className={classNames(className)}
    />
  );
}
