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

type ShellSearch = Omit<ShellParams,'page'|'pageSize'|'learningPage'> & {
  readonly page?:string|number;
  readonly pageSize?:string|number;
  readonly learningPage?:string|number;
  readonly flow?: ShellFlow;
  readonly candidate?: string;
};

function SensaRootRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const known = pathname === '/' || pathname === '/welcome' || pathname === '/how-it-works' || isKnownShellPath(pathname);
  return known ? <App /> : <ProductRecovery kind="not_found" />;
}

const rootRoute = createRootRoute({
  component: SensaRootRoute,
  // A rejected lazy import is retained by React/the module loader. Resetting
  // the route alone renders that same rejection again, even after reconnect.
  errorComponent: ({ error, reset }: ErrorComponentProps) => <ProductRecovery kind="error" onRetry={reset} reload={/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script/iu.test(error.message)} />,
  notFoundComponent: () => <ProductRecovery kind="not_found" />,
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): ShellSearch => {
    const candidate=typeof search.candidate==='string'&&/^[0-9a-f-]{36}$/i.test(search.candidate)?search.candidate:undefined;
    const params:ShellSearch = {...parseShellParams(search),...(candidate?{candidate}:{})};
    const numeric:Partial<Record<'page'|'pageSize'|'learningPage',number>>={};
    for(const key of ['page','pageSize','learningPage'] as const){
      const value=params[key];
      if(typeof value==='string'&&/^\d+$/u.test(value)&&Number.isSafeInteger(Number(value)))numeric[key]=Number(value);
    }
    const normalized={...params,...numeric};
    const viewMode = parseViewMode(search.flow);
    return viewMode === 'main' ? normalized : { ...normalized, flow: viewMode };
  },
});

/** The main shell with an empty sheet stack. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
});

/** Explicit public landing preview; Root decides whether to show the landing page. */
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'welcome',
});

const howItWorksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'how-it-works',
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
});

const routeTree = rootRoute.addChildren([indexRoute, welcomeRoute, howItWorksRoute, stackRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
