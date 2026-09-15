import { useSyncExternalStore } from "react";
import { previewStorage } from "../services/previewStorage";
import {
  defaultAppearancePreference,
  parseAppearancePreference,
  resolveAppearance,
  serializeAppearancePreference,
  type AppearancePreference,
} from "./contract";

const STORAGE_KEY = "appearance";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
let preference = readPreference();
let initialized = false;

function readPreference(): AppearancePreference {
  try {
    return parseAppearancePreference(previewStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...defaultAppearancePreference };
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_MODE_QUERY).matches;
}

function applyPreference(): void {
  if (typeof document === "undefined") return;
  const resolved = resolveAppearance(preference, systemPrefersDark());
  const root = document.documentElement;
  root.dataset.sensaSkin = resolved.skin;
  root.dataset.sensaColorMode = resolved.resolvedColorMode;
  root.dataset.sensaTextSize = resolved.textSize;
  root.style.colorScheme = resolved.resolvedColorMode;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function replaceFromStorage(): void {
  preference = readPreference();
  applyPreference();
  emit();
}

/** Apply appearance before React renders, then keep OS and other-tab changes in sync. */
export function initializeAppearance(): void {
  preference = readPreference();
  applyPreference();
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const colorScheme = window.matchMedia(DARK_MODE_QUERY);
  colorScheme.addEventListener("change", applyPreference);
  previewStorage.subscribe(STORAGE_KEY, replaceFromStorage);
}

export function setAppearancePreference(next: AppearancePreference): void {
  preference = parseAppearancePreference(serializeAppearancePreference(next));
  try {
    previewStorage.setItem(STORAGE_KEY, serializeAppearancePreference(preference));
  } catch {
    // An in-session preference still applies when browser storage is unavailable.
  }
  applyPreference();
  emit();
}

export function updateAppearancePreference(patch: Partial<AppearancePreference>): void {
  setAppearancePreference({ ...preference, ...patch });
}

export function useAppearancePreference(): AppearancePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preference,
    () => defaultAppearancePreference,
  );
}
