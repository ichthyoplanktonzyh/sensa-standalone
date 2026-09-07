import { restoreSiblingInteraction } from './screenInteraction';
import { useEffect, type RefObject } from 'react';

/** Keep keyboard focus in visible modal surfaces without changing their actions. */
export function useModalFocus(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let current: HTMLElement | null = null;
    let previousFocus: HTMLElement | null = null;
    let restore: (() => void)[] = [];
    const focusable = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter(node => !node.closest('[inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const update = () => {
      const next = [...element.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .filter(node => !node.closest('.screen[aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden').at(-1) ?? null;
      if (next === current) return;
      restore.forEach(fn => fn());
      restore = [];
      const closing = current;
      current = next;
      if (!next) {
        if (closing && previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
        previousFocus = null;
        return;
      }
      if (!closing) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let branch: HTMLElement = next;
      while (branch !== element && branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
          const wasInert = sibling.inert;
          sibling.inert = true;
          restore.push(() => {
            // Navigation may have changed while the dialog was open. Respect
            // the current route instead of restoring a stale screen lock.
            restoreSiblingInteraction(sibling, wasInert);
          });
        }
        branch = branch.parentElement;
      }
      if (!next.contains(document.activeElement)) focusable(next)[0]?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !current) return;
      const items = focusable(current);
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    element.addEventListener('keydown', onKey);
    update();
    return () => { observer.disconnect(); element.removeEventListener('keydown', onKey); restore.forEach(fn => fn()); };
  }, [root]);
}
