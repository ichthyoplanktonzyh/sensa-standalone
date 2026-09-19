import { useLayoutEffect, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
const isolated = new Map<HTMLElement, boolean>();

function visibleFocusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.closest("[inert]")
    && node.getClientRects().length > 0
    && getComputedStyle(node).visibility !== "hidden");
}

function restoreIsolation(): void {
  for (const [element, previous] of isolated) {
    element.inert = element.hasAttribute("data-sensa-screen-slot")
      ? element.getAttribute("data-sensa-screen-interactive") !== "true"
      : previous;
  }
  isolated.clear();
}

function topDialog(): HTMLElement | undefined {
  for (let index = dialogs.length - 1; index >= 0; index -= 1) {
    if (dialogs[index]?.isConnected) return dialogs[index];
  }
  return undefined;
}

function synchronizeIsolation(): HTMLElement | undefined {
  restoreIsolation();
  const top = topDialog();
  if (!top) return undefined;
  let branch = top;
  while (branch !== document.body && branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      isolated.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    branch = branch.parentElement;
  }
  return top;
}

function focusDialog(dialog: HTMLElement): void {
  if (!dialog.contains(document.activeElement)) {
    (visibleFocusable(dialog)[0] ?? dialog).focus();
  }
}

/** Own focus and background interaction for one mounted modal, without DOM observation. */
export function useDialogFocus(
  panel: RefObject<HTMLElement | null>,
  modal: boolean,
): void {
  useLayoutEffect(() => {
    const dialog = panel.current;
    if (!dialog || !modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogs.push(dialog);
    focusDialog(synchronizeIsolation() ?? dialog);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || topDialog() !== dialog) return;
      const items = visibleFocusable(dialog);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      const index = dialogs.lastIndexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      const next = synchronizeIsolation();
      if (next) focusDialog(next);
      else if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus();
    };
  }, [modal, panel]);
}
