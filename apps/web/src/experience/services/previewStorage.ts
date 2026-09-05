/** Temporary frontend adapter. M1 replaces it with the authoritative API/Sync.
 * It must never read, migrate, clear or overwrite the legacy Web's local data.
 */
const PREFIX = 'sensa:web-ui:v1:';
export const previewStorage = {
  getItem(key: string): string | null {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(PREFIX + key);
  },
  setItem(key: string, value: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(PREFIX + key, value);
  },
  removeItem(key: string): void {
    if (typeof window !== 'undefined') window.localStorage.removeItem(PREFIX + key);
  },
};
