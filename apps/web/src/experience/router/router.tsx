import {
  createRootRoute,
  createRoute,
  createRouter,
  type SearchSchemaInput,
} from '@tanstack/react-router';
import App from '../App';
import { parseShellParams, parseViewMode, type ShellFlow, type ShellParams } from './shellLocation';

/**
 * App renders the whole shell -- every screen stays mounted and is shown or
 * hidden by an `active` prop, because sheets animate in and out via CSS
 * transform and must keep their scroll position and local state.
 *
 * So the route tree exists to own the URL, not to swap components: App is the
 * root route's component, and the child routes below only declare which
 * pathnames are legal. `useShellNavigation` reads the location back out.
 */

interface ShellSearch extends ShellParams {
  readonly flow?: ShellFlow;
}

const rootRoute = createRootRoute({
  component: App,
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): ShellSearch => {
    const params = parseShellParams(search);
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
