/** Accept only an explicit support mailbox or a public HTTPS support form. */
export function parseSupportUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') {
      const mailbox = decodeURIComponent(url.pathname);
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(mailbox) ? url.href : null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.invalid')) return null;
    if (/^[\d.]+$/u.test(url.hostname) || url.hostname.includes(':')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export const configuredSupportUrl = (): string | null =>
  parseSupportUrl(import.meta.env.VITE_SENSA_SUPPORT_URL);
