import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { meApi, signOut } from '@glazion/api-client';
import { AccountStatus } from '@glazion/types';
import Screen from '../../../components/Screen';
import { Badge, Button, Card, Row, Text } from '../../../components/ui';
import { colors, font, space, textSize, type Tone } from '../../../theme';

const STATUS: Record<AccountStatus, { label: string; tone: Tone }> = {
  [AccountStatus.Pending]: { label: 'Pending', tone: 'warn' },
  [AccountStatus.Active]: { label: 'Active', tone: 'ok' },
  [AccountStatus.Suspended]: { label: 'Suspended', tone: 'bad' },
  [AccountStatus.Disabled]: { label: 'Disabled', tone: 'neutral' },
};

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Account() {
  const [leaving, setLeaving] = useState(false);
  // Already cached by the time this tab opens.
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get });

  const name = me.data?.displayName ?? me.data?.username ?? '';
  const status = me.data ? STATUS[me.data.accountStatus] : null;

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
  }

  return (
    <Screen tab title="Account">
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" style={{ fontSize: textSize.lg }}>
            {name || '—'}
          </Text>
          {me.data?.username && <Text variant="muted">@{me.data.username}</Text>}
        </View>
      </View>

      <Card>
        <Row label="Status" value={status ? <Badge label={status.label} tone={status.tone} /> : '—'} />
        {me.data && <Row label="Member since" value={new Date(me.data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />}
      </Card>

      <Button label="Sign out" icon="log-out" kind="secondary" onPress={handleSignOut} loading={leaving} loadingLabel="Signing out…" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  avatarText: { fontFamily: font.bold, fontSize: textSize.lg, color: '#fff' },
});
