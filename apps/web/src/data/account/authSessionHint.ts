const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/** Supabase's persisted-session key, without importing or initializing its SDK. */
export const authStorageKey = projectUrl
  ? `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`
  : undefined;

export function cachedAuthSubject(): string | null | undefined {
  if (!authStorageKey) return null;
  try {
    const raw = localStorage.getItem(authStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.user?.id === 'string' ? parsed.user.id : undefined;
  } catch {
    return undefined;
  }
}

/** An email callback must enter the account runtime even before a session exists. */
export function hasAuthCallback(location: Location = window.location): boolean {
  const search = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  return ['code', 'error', 'error_code', 'access_token', 'refresh_token']
    .some((key) => search.has(key) || fragment.has(key));
}
