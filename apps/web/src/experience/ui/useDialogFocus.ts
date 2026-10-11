import { useLayoutEffect, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
const isolated = new Map<HTMLElement, boolean>();

function visibleFocusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], summary, audio[controls], iframe, [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.hasAttribute('data-sensa-focus-guard')
    && (() => {
      for (let disclosure = node.closest('details:not([open])'); disclosure; disclosure = disclosure.parentElement?.closest('details:not([open])') ?? null) {
        if (!disclosure.querySelector(':scope > summary')?.contains(node)) return false;
      }
      return true;
    })()
    && !node.closest("[inert]")
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
    // Sentinels wrap only after native controls finish their own Tab sequence.
    // Audio controls and iframe contents expose several stops behind one host.
    const guard = (atStart: boolean) => {
      const node = document.createElement('span');
      node.tabIndex = 0;
      node.dataset.sensaFocusGuard = '';
      Object.assign(node.style, {position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none'});
      node.addEventListener('focus', () => {
        if (topDialog() !== dialog) return;
        const items = visibleFocusable(dialog);
        (atStart ? items.at(-1) : items[0])?.focus();
        if (!items.length) dialog.focus();
      });
      return node;
    };
    const startGuard = guard(true), endGuard = guard(false);
    dialog.prepend(startGuard);
    dialog.append(endGuard);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && topDialog() === dialog && !visibleFocusable(dialog).length) {
        event.preventDefault();
        dialog.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      startGuard.remove();
      endGuard.remove();
      const index = dialogs.lastIndexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      const next = synchronizeIsolation();
      if (next) focusDialog(next);
      else if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus();
    };
  }, [modal, panel]);
}
