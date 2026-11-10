import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { configureApiClient, tokenStore, type KeyValueStorage } from '@glazion/api-client';

// Tokens go in the device keychain/keystore. The browser preview has neither, so it falls back
// to localStorage like the web apps.
const storage: KeyValueStorage =
  Platform.OS === 'web'
    ? {
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: (key) => localStorage.removeItem(key),
      }
    : {
        getItem: (key) => SecureStore.getItem(key),
        setItem: (key, value) => SecureStore.setItem(key, value),
        removeItem: (key) => {
          SecureStore.deleteItemAsync(key).catch(() => {});
        },
      };

configureApiClient({ storage });

export function useSignedIn(): boolean {
  return useSyncExternalStore(
    tokenStore.subscribe,
    () => tokenStore.access !== null,
    () => false,
  );
}
