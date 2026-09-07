import i18n from "./index";
import type { runtimeZh } from "./runtime";
export const runtimeText = (
  key: keyof typeof runtimeZh,
  values?: Record<string, unknown>,
): string => i18n.t(`runtime.${key}`, values);
