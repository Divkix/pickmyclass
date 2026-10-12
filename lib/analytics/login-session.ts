import { LOGIN_SESSION_STORAGE_KEY } from "@/lib/config";

export type LoginSessionStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Returns true the first time a Clerk session id is seen in this browser, so
 * `user_logged_in` fires once per sign-in rather than on every page load or
 * identity refresh. Unreadable storage returns false: under-counting a login
 * is safer than counting one per page view.
 */
export function claimLoginSession(readStore: () => LoginSessionStore, sessionId: string): boolean {
  try {
    const store = readStore();

    if (store.getItem(LOGIN_SESSION_STORAGE_KEY) === sessionId) return false;
    store.setItem(LOGIN_SESSION_STORAGE_KEY, sessionId);

    return true;
  } catch {
    return false;
  }
}
