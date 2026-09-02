import { useCallback, useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  buildPathname,
  parseMainStack,
  parseViewMode,
  type ShellFlow,
  type ViewMode,
} from './shellLocation';

/**
 * The shell's navigation state, read from and written to the URL.
 *
 * This deliberately keeps the exact shape App used when `viewMode` and
 * `mainStack` were `useState` -- same names, same call signatures -- so the
 * ~100 existing call sites are untouched by the move to routing. What changes
 * is only where the state lives: the URL is now the single source of truth,
 * which is what buys deep links, browser back/forward and shareable state.
 *
 * `goMain` keeps the original push semantics: re-pushing a sheet already on
 * the stack is a no-op rather than a duplicate entry.
 */
export interface ShellNavigation {
  readonly viewMode: ViewMode;
  readonly mainStack: readonly string[];
  setViewMode: (mode: ViewMode) => void;
  goMain: (sheetId: string) => void;
  backMain: () => void;
  resetMain: () => void;
  setMainStack: (stack: readonly string[]) => void;
}

export function useShellNavigation(): ShellNavigation {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const flow = useRouterState({
    select: (state) => (state.location.search as { flow?: unknown }).flow,
  });

  const mainStack = useMemo(() => parseMainStack(pathname), [pathname]);
  const viewMode = parseViewMode(flow);

  /**
   * Move the sheet stack while leaving the learning flow untouched, and vice
   * versa. The two dimensions are independent, so neither writer may clobber
   * the other's half of the URL.
   */
  const goToStack = useCallback(
    (stack: readonly string[]) => {
      const path = buildPathname(stack);
      const keepFlow = (previous: Record<string, unknown>) => previous;
      if (path === '/') {
        navigate({ to: '/', search: keepFlow });
        return;
      }
      navigate({ to: '/$', params: { _splat: path.slice(1) }, search: keepFlow });
    },
    [navigate],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => {
          const { flow: _dropped, ...rest } = previous;
          return mode === 'main' ? rest : { ...rest, flow: mode satisfies ShellFlow };
        },
      });
    },
    [navigate],
  );

  const goMain = useCallback(
    (sheetId: string) => {
      if (mainStack.includes(sheetId)) return;
      goToStack([...mainStack, sheetId]);
    },
    [mainStack, goToStack],
  );

  const backMain = useCallback(() => {
    goToStack(mainStack.slice(0, -1));
  }, [mainStack, goToStack]);

  const resetMain = useCallback(() => {
    goToStack([]);
  }, [goToStack]);

  const setMainStack = useCallback(
    (stack: readonly string[]) => {
      goToStack(stack);
    },
    [goToStack],
  );

  return { viewMode, mainStack, setViewMode, goMain, backMain, resetMain, setMainStack };
}
