import PocketBase from "pocketbase";

/**
 * Verifies an admin-dashboard bearer token by asking PocketBase to refresh
 * it against the `operators` auth collection. This replaces a static
 * shared ADMIN_TOKEN: the server never needs to know PocketBase's signing
 * secret, it just asks PocketBase "is this still a valid operator token?"
 * on every request — PocketBase already validates signature, expiry, and
 * that the record still exists.
 */
export function createOperatorTokenVerifier(pocketbaseUrl: string): (token: string) => Promise<boolean> {
  return async (token: string): Promise<boolean> => {
    if (!token) return false;
    const pb = new PocketBase(pocketbaseUrl);
    pb.authStore.save(token, null);
    try {
      await pb.collection("operators").authRefresh();
      return true;
    } catch {
      return false;
    }
  };
}
