const requestTimeoutMs = 15_000;

export type ContentCatalogResponse =
  | Readonly<{ kind: 'not_modified' }>
  | Readonly<{ kind: 'loaded'; value: unknown }>;

/** Public-catalog transport details do not escape into the domain interface. */
export async function fetchContentCatalog(
  revision: string | null,
  callerSignal?: AbortSignal,
): Promise<ContentCatalogResponse> {
  const endpoint = import.meta.env.VITE_SENSA_API_URL as string | undefined;
  if (!endpoint) throw new Error('localFlow.onlineUnavailable');

  const headers: Record<string, string> = {};
  if (revision) headers['if-none-match'] = `"${revision}"`;
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const response = await fetch(`${endpoint.replace(/\/+$/u, '')}/sensa/packages`, {
    headers,
    signal,
    redirect: 'error',
  });
  if (response.status !== 304 && !response.ok) throw new Error('localFlow.onlineUnavailable');

  return response.status === 304
    ? { kind: 'not_modified' }
    : { kind: 'loaded', value: await response.json() };
}
