import type { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space, textSize } from '../theme';
import { Text } from './ui';

interface Props {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** The frame shared by sign-in, sign-up and password reset: symbol, heading, form, footer. */
export default function AuthScreen({ title, subtitle, children, footer }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Image source={require('../../assets/mark.png')} style={styles.mark} accessibilityLabel="Glazion" />
            <Text variant="title" style={styles.title}>
              {title}
            </Text>
            <Text variant="muted" style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>
          <View style={styles.form}>{children}</View>
          {footer && <View style={styles.footer}>{footer}</View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: space.xxl, width: '100%', maxWidth: 460, alignSelf: 'center' },
  head: { alignItems: 'center' },
  mark: { width: 56, height: 56, marginBottom: space.xl },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginTop: 10, maxWidth: 300, fontSize: textSize.md, color: colors.ink2 },
  form: { marginTop: 32, gap: space.lg },
  footer: { marginTop: 24, alignItems: 'center' },
});
