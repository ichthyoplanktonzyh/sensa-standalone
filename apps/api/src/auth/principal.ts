import { HttpError } from "../shared/errors.js";
import { readSensaApiEnvironment } from "../server/environment.js";

export type AuthenticatedPrincipal = Readonly<{
  learnerUserId: string;
  email: string | null;
  transport: "local" | "cognito";
}>;

export interface AuthenticatedPrincipalAdapter {
  authenticate(request: Request): Promise<AuthenticatedPrincipal>;
}

class CognitoPrincipalAdapter implements AuthenticatedPrincipalAdapter {
  async authenticate(_request: Request): Promise<AuthenticatedPrincipal> {
    throw new HttpError(
      501,
      "Cognito authentication is not configured in this standalone local build.",
      "AUTH_COGNITO_ADAPTER_NOT_CONFIGURED",
    );
  }
}

export function createCognitoPrincipalAdapter(): AuthenticatedPrincipalAdapter {
  return new CognitoPrincipalAdapter();
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost"
    || normalized === "::1"
    || /^127(?:\.[0-9]{1,3}){3}$/u.test(normalized);
}

function requireLocalMode(request: Request): void {
  const environment = readSensaApiEnvironment();
  if (environment.ALLOW_INSECURE_LOCAL_AUTH !== "true") {
    throw new HttpError(
      403,
      "Local authentication requires ALLOW_INSECURE_LOCAL_AUTH=true.",
      "AUTH_LOCAL_MODE_NOT_EXPLICIT",
    );
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw new HttpError(400, "Request URL is invalid.", "AUTH_REQUEST_URL_INVALID");
  }
  if (!isLoopbackHost(requestUrl.hostname)) {
    throw new HttpError(
      403,
      "Insecure local authentication is available only on a loopback host.",
      "AUTH_LOCAL_MODE_LOOPBACK_ONLY",
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new HttpError(503, "DATABASE_URL is required for local authentication.", "DATABASE_CONFIG_MISSING");
  }
  let databaseHost: string;
  try {
    databaseHost = new URL(databaseUrl).hostname;
  } catch {
    throw new HttpError(503, "DATABASE_URL is invalid.", "DATABASE_CONFIG_INVALID");
  }
  if (!isLoopbackHost(databaseHost)) {
    throw new HttpError(
      403,
      "Insecure local authentication requires a loopback database.",
      "AUTH_LOCAL_DATABASE_LOOPBACK_ONLY",
    );
  }
}

export async function authenticatePrincipal(
  request: Request,
  cognitoAdapter: AuthenticatedPrincipalAdapter = createCognitoPrincipalAdapter(),
): Promise<AuthenticatedPrincipal> {
  const environment = readSensaApiEnvironment();
  if (environment.AUTH_MODE === "none") {
    requireLocalMode(request);
    const learnerUserId = environment.SENSA_LOCAL_LEARNER_ID || "sensa-local-first-user";
    return {
      learnerUserId,
      email: environment.SENSA_LOCAL_EMAIL || null,
      transport: "local",
    };
  }

  return cognitoAdapter.authenticate(request);
}
