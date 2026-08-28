import { authenticatePrincipal, type AuthenticatedPrincipal } from "../auth/principal.js";
import { HttpError } from "../shared/errors.js";
import { isWorkspaceId, normalizeWorkspaceId } from "../workspaces/identity.js";
import { readSensaApiEnvironment } from "./environment.js";

export type RequestContext = Readonly<{
  userId: string;
  subjectUserId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  transport: "local" | "cognito";
}>;

export function parseWorkspaceIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "workspaceId is required", "WORKSPACE_ID_REQUIRED");
  }
  const normalized = normalizeWorkspaceId(value);
  if (!isWorkspaceId(normalized)) {
    throw new HttpError(400, "workspaceId must be a UUID", "WORKSPACE_ID_INVALID");
  }
  return normalized;
}

function requestContextForPrincipal(principal: AuthenticatedPrincipal): RequestContext {
  const environment = readSensaApiEnvironment();
  return {
    userId: principal.learnerUserId,
    subjectUserId: principal.learnerUserId,
    selectedWorkspaceId: environment.SENSA_LOCAL_WORKSPACE_ID || null,
    email: principal.email,
    locale: environment.SENSA_LOCAL_LOCALE,
    transport: principal.transport,
  };
}

export async function loadRequestContextFromRequest(
  request: Request,
  _allowedOrigins: ReadonlyArray<string> = [],
): Promise<Readonly<{ requestContext: RequestContext }>> {
  return { requestContext: requestContextForPrincipal(await authenticatePrincipal(request)) };
}
