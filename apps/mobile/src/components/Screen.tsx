import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '../theme';
import { KeyboardDoneBar, Text } from './ui';

interface Props {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Tab screens draw their own title and need the top inset; pushed screens have a header. */
  tab?: boolean;
  /** Set to false for screens whose body is a list that scrolls itself. */
  scroll?: boolean;
  /** The screen's main action, pinned under the content (and above the keyboard) so it's always in reach. */
  footer?: ReactNode;
}

export default function Screen({ title, subtitle, action, children, tab = false, scroll = true, footer }: Props) {
  const head = title && (
    <View style={styles.head}>
      <View style={{ flex: 1 }}>
        <Text variant="title">{title}</Text>
        {subtitle && (
          <Text variant="muted" style={{ color: colors.ink2, marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={tab ? ['top'] : []}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          // Dragging the page closes the keyboard, so it never hides the rest of a form for long.
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {head}
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>
            {head && <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg }}>{head}</View>}
            {children}
          </View>
        )}
        {footer && (
          <View style={styles.footer}>
            <View style={styles.footerBody}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
      <KeyboardDoneBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: space.xl, paddingBottom: 40, gap: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: 4 },
  footer: { paddingHorizontal: space.xl, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.surface },
  footerBody: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: space.sm },
});
