import { useEffect, type ReactNode } from 'react';
import { AppState, Image, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router/stack';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, meApi, signOut } from '@glazion/api-client';
import { AccountStatus } from '@glazion/types';
import { Button, Loading, Text } from '../../components/ui';
import { colors, font, space, textSize } from '../../theme';

const BLOCKED_COPY: Partial<Record<AccountStatus, { title: string; text: string }>> = {
  [AccountStatus.Suspended]: {
    title: 'Your account is suspended',
    text: 'Get in touch with Glazion support if you think this is a mistake.',
  },
  [AccountStatus.Disabled]: {
    title: 'This account has been disabled',
    text: 'Get in touch with Glazion support if you need access again.',
  },
};

function Gate({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <View style={styles.gate}>
      <Image source={require('../../../assets/mark.png')} style={styles.mark} />
      <Text variant="heading" style={{ textAlign: 'center', fontSize: textSize.lg }}>
        {title}
      </Text>
      <Text variant="muted" style={{ textAlign: 'center', color: colors.ink2, maxWidth: 320, marginBottom: space.md }}>
        {text}
      </Text>
      {children}
    </View>
  );
}

export default function AppLayout() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    // While waiting for approval, look again every minute, so the app opens by itself once it's approved.
    refetchInterval: (query) => (query.state.data?.accountStatus === AccountStatus.Pending ? 60_000 : false),
  });
  const pending = me.data?.accountStatus === AccountStatus.Pending;
  const { refetch } = me;

  // And as soon as the app is opened again, which is when someone is looking.
  useEffect(() => {
    if (!pending) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => subscription.remove();
  }, [pending, refetch]);

  if (me.isPending) return <Loading />;
  if (me.isError) {
    return (
      <Gate title="We couldn’t load your account" text={errorMessage(me.error)}>
        <Button label="Try again" kind="secondary" onPress={() => me.refetch()} />
      </Gate>
    );
  }

  if (pending) {
    const checked = new Date(me.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
      <Gate
        title="Your account is waiting for approval"
        text="An admin needs to approve it before you can use Glazion. The app checks every minute and opens by itself once it’s approved."
      >
        <View style={styles.actions}>
          <Button label="Check again" onPress={() => me.refetch()} loading={me.isFetching} loadingLabel="Checking…" />
          <Button label="Sign out" kind="secondary" onPress={() => signOut()} />
        </View>
        <Text variant="small" accessibilityLiveRegion="polite" style={{ textAlign: 'center', marginTop: space.sm }}>
          Still waiting. Last checked at {checked}.
        </Text>
      </Gate>
    );
  }

  const blocked = BLOCKED_COPY[me.data.accountStatus];
  if (blocked) {
    return (
      <Gate {...blocked}>
        <Button label="Sign out" kind="secondary" onPress={() => signOut()} />
      </Gate>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: font.bold, fontSize: textSize.lg },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.canvas },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="results/[searchId]" options={{ title: 'Matching tiles' }} />
      <Stack.Screen name="result/[searchId]/[imageId]" options={{ title: 'About this tile' }} />
      <Stack.Screen name="conversation/[id]" options={{ title: '' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: space.xxl, backgroundColor: colors.surface },
  mark: { width: 56, height: 56, marginBottom: space.md },
  actions: { alignSelf: 'stretch', maxWidth: 320, width: '100%', marginHorizontal: 'auto', gap: space.sm },
});
