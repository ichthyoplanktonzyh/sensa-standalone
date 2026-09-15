import {
  BookOpen,
  Compass,
  GraduationCap,
  Home,
  House,
  Layers3,
  LibraryBig,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { HTMLAttributes } from "react";
import {
  type SkinAssetSet,
  type SkinIconRole,
} from "./assetContract";
import { useAppearancePreference } from "./store";
import type { SkinId } from "./contract";
import { classNames } from "../ui/primitives";

interface SkinAssetAdapter {
  readonly id: SkinAssetSet;
  readonly strokeWidth: number;
  readonly icons: Readonly<Record<SkinIconRole, LucideIcon>>;
}

const skinAssetAdapters: Readonly<Record<SkinId, SkinAssetAdapter>> = {
  quiet: {
    id: "quiet-editorial",
    strokeWidth: 1.6,
    icons: {
      "navigation-home": Home,
      "navigation-world": LibraryBig,
      "navigation-learning": GraduationCap,
      "navigation-practice": Sparkles,
      "navigation-settings": SlidersHorizontal,
    },
  },
  clear: {
    id: "clear-utility",
    strokeWidth: 1.5,
    icons: {
      "navigation-home": House,
      "navigation-world": BookOpen,
      "navigation-learning": Layers3,
      "navigation-practice": Compass,
      "navigation-settings": Settings2,
    },
  },
};

export interface SensaSkinIconProps extends LucideProps {
  readonly role: SkinIconRole;
}

/** Product code requests a semantic icon role; the curated Skin resolves its glyph. */
export function SensaSkinIcon({ role, strokeWidth, ...props }: SensaSkinIconProps) {
  const { skin } = useAppearancePreference();
  const adapter = skinAssetAdapters[skin];
  const Icon = adapter.icons[role];
  return (
    <Icon
      {...props}
      data-sensa-skin-asset={role}
      data-sensa-asset-set={adapter.id}
      strokeWidth={strokeWidth ?? adapter.strokeWidth}
    />
  );
}

export function SensaBrandMark({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { skin } = useAppearancePreference();
  const adapter = skinAssetAdapters[skin];
  return (
    <span
      {...props}
      data-sensa-shell-brand-mark
      data-sensa-skin-asset="brand-mark"
      data-sensa-asset-set={adapter.id}
      aria-hidden="true"
      className={classNames(className)}
    >
      <i />
      <i />
    </span>
  );
}
