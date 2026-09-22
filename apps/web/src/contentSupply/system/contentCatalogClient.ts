const sessionTimeoutMs = 3_000;
const requestTimeoutMs = 15_000;

export type ContentCatalogResponse =
  | Readonly<{ kind: 'not_modified' }>
  | Readonly<{ kind: 'loaded'; value: unknown }>;

/** Online-service adapter. Account and transport details do not escape into the domain interface. */
export async function fetchContentCatalog(
  revision: string | null,
  callerSignal?: AbortSignal,
): Promise<ContentCatalogResponse> {
  const { auth } = await import('../../data/account/auth');
  const endpoint = import.meta.env.VITE_SENSA_API_URL as string | undefined;
  if (!auth || !endpoint) throw new Error('localFlow.onlineUnavailable');

  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = (await Promise.race([
      auth.getSession(),
      new Promise<never>((_, reject) => {
        sessionTimer = setTimeout(() => reject(new Error('localFlow.onlineUnavailable')), sessionTimeoutMs);
      }),
    ])).data.session;
    if (!session) throw new Error('localFlow.onlineUnavailable');

    const headers: Record<string, string> = { authorization: `Bearer ${session.access_token}` };
    if (revision) headers['if-none-match'] = `"${revision}"`;
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const response = await fetch(`${endpoint.replace(/\/+$/u, '')}/sensa/packages`, {
      headers,
      signal,
      redirect: 'error',
    });
    if (response.status !== 304 && !response.ok) throw new Error('localFlow.onlineUnavailable');

    const value = response.status === 304 ? undefined : await response.json();
    const currentSubject = (await auth.getSession()).data.session?.user.id;
    if (currentSubject !== session.user.id) throw new Error('localFlow.accountChanged');
    return response.status === 304
      ? { kind: 'not_modified' }
      : { kind: 'loaded', value };
  } finally {
    clearTimeout(sessionTimer);
  }
}
