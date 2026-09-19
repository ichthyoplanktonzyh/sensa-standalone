import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  type SearchSchemaInput,
  useRouterState,
} from '@tanstack/react-router';
import App from '../../application/Root';
import { ProductRecovery } from '../../application/ProductRecovery';
import { isKnownShellPath, parseShellParams, parseViewMode, type ShellFlow, type ShellParams } from './shellLocation';

/**
 * App renders the shell plus a bounded screen host. The URL still records the
 * navigation stack, while only the current and briefly outgoing screens mount.
 * Scroll and selected non-authoritative UI state are restored explicitly.
 *
 * So the route tree exists to own the URL, not to swap components: App is the
 * root route's component, and the child routes below only declare which
 * pathnames are legal. `useShellNavigation` reads the location back out.
 */

interface ShellSearch extends ShellParams {
  readonly flow?: ShellFlow;
  readonly candidate?: string;
}

function SensaRootRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === '/' || isKnownShellPath(pathname)
    ? <App />
    : <ProductRecovery kind="not_found" />;
}

const rootRoute = createRootRoute({
  component: SensaRootRoute,
  errorComponent: ({ reset }: ErrorComponentProps) => <ProductRecovery kind="error" onRetry={reset} />,
  notFoundComponent: () => <ProductRecovery kind="not_found" />,
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): ShellSearch => {
    const candidate=typeof search.candidate==='string'&&/^[0-9a-f-]{36}$/i.test(search.candidate)?search.candidate:undefined;
    const params = {...parseShellParams(search),...(candidate?{candidate}:{})};
    const viewMode = parseViewMode(search.flow);
    return viewMode === 'main' ? params : { ...params, flow: viewMode };
  },
});

/** The main shell with an empty sheet stack. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => null,
});

/**
 * Every non-empty sheet stack. A splat rather than a nested tree because the
 * stack is genuinely dynamic: the same screen opens from several parents (a
 * Sense detail reaches from both the content library and the semantic world)
 * and returns to whichever pushed it. Enumerating those combinations as a
 * static tree would encode today's prototype navigation into the router and
 * force a route-tree edit on every product change.
 */
const stackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: () => null,
});

const routeTree = rootRoute.addChildren([indexRoute, stackRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
