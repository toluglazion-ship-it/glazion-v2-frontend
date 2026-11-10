import { captureApi, getStoredUser, meApi, myTasksApi } from '@glazion/api-client';

/**
 * Wraps a request so its last good answer is kept on the phone. With no connection the kept copy
 * is returned, which is what lets someone open the app and photograph tiles while offline.
 */
function withOfflineCopy<T>(name: string, request: () => Promise<T>): () => Promise<T> {
  return async () => {
    const key = `glazion_offline_${name}_${getStoredUser()?.id ?? 'guest'}`;
    try {
      const data = await request();
      localStorage.setItem(key, JSON.stringify(data));
      return data;
    } catch (err) {
      // A TypeError is the browser saying the request never reached the server.
      if (err instanceof TypeError) {
        const kept = localStorage.getItem(key);
        if (kept) return JSON.parse(kept) as T;
      }
      throw err;
    }
  };
}

export const meQuery = { queryKey: ['me'], queryFn: withOfflineCopy('me', meApi.get) };

export const captureContextQuery = { queryKey: ['capture-context'], queryFn: withOfflineCopy('capture-context', captureApi.getContext) };

/** Your tile tasks. Kept on the phone too, so the list (and photographing a task) works offline. */
export const myTasksQuery = { queryKey: ['my-tasks'], queryFn: withOfflineCopy('my-tasks', () => myTasksApi.list()) };
