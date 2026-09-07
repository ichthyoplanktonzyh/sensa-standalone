/** Modal restoration must use current route ownership, not an old inert snapshot. */
export function restoreSiblingInteraction(
  sibling: HTMLElement,
  previousInert: boolean,
): void {
  sibling.inert = sibling.classList.contains("screen")
    ? sibling.getAttribute("aria-hidden") === "true"
    : previousInert;
}

/** One foreground screen owns both pointer input and visible content. */
export function presentScreen(
  screen: HTMLElement,
  foreground: boolean,
  focused: boolean,
): void {
  screen.inert = !foreground;
  screen.setAttribute("aria-hidden", String(!foreground));
  screen.style.setProperty(
    "visibility",
    foreground ? "visible" : "hidden",
    "important",
  );
  screen.style.setProperty(
    "pointer-events",
    foreground ? "auto" : "none",
    "important",
  );
  if (!focused)
    screen.style.setProperty("z-index", foreground ? "100" : "0", "important");
}

/** Reference overlays own the foreground independently of runtime CSS z-index. */
export function foregroundScreen(
  screens: readonly HTMLElement[],
  current: string,
  focused: boolean,
  zIndex: (screen: HTMLElement) => number,
): HTMLElement | undefined {
  const active = screens.filter(screen=>screen.classList.contains('active'));
  const overlays = active.filter(screen=>Number(screen.getAttribute('data-screen-layer'))>0);
  if(overlays.length) return overlays.reduce((top,screen)=>
    Number(screen.getAttribute('data-screen-layer'))>Number(top.getAttribute('data-screen-layer'))?screen:top);
  if(!focused)return screens.find(screen=>screen.id===current);
  return active.reduce<HTMLElement|undefined>((top,screen)=>!top||zIndex(screen)>=zIndex(top)?screen:top,undefined);
}
