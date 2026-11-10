import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, space, textSize } from '../theme';
import { Icon, Text } from './ui';

// Short confirmations for actions whose result is easy to miss, same idea as the web apps.

/** One follow-up, such as "Undo", offered for a moment after the action. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
}

const VISIBLE_MS = 3500;
/** Long enough to read the message and reach the button. */
const WITH_ACTION_MS = 8000;

let current: ToastItem | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function emit(next: ToastItem | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function toast(message: string, options?: { action?: ToastAction }) {
  const id = nextId++;
  emit({ id, message, action: options?.action });
  setTimeout(
    () => {
      if (current?.id === id) emit(null);
    },
    options?.action ? WITH_ACTION_MS : VISIBLE_MS,
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Render once, in the root layout. */
export function ToastHost() {
  const item = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const insets = useSafeAreaInsets();

  if (!item) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 76 }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <View style={styles.toast} pointerEvents={item.action ? 'auto' : 'none'}>
        <Icon name="check" size={18} color="#7fe0ae" />
        <Text style={styles.text}>{item.message}</Text>
        {item.action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              item.action!.onPress();
              emit(null);
            }}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{item.action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 420,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    boxShadow: '0 12px 28px rgba(14, 19, 32, 0.25)',
  },
  text: { flexShrink: 1, fontFamily: font.medium, fontSize: textSize.sm, color: '#fff' },
  action: { minHeight: 36, paddingHorizontal: 8, justifyContent: 'center', marginLeft: 4 },
  actionLabel: { fontFamily: font.bold, fontSize: textSize.sm, color: '#9cc8ff' },
});
