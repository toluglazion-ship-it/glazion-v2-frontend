import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { chatApi } from '@glazion/api-client/main';
import Screen from '../../../components/Screen';
import { Button, Empty, Icon, Loading, Text } from '../../../components/ui';
import { relativeTime } from '../../../lib/time';
import { usePush } from '../../../lib/usePush';
import { colors, space } from '../../../theme';

export default function Conversations() {
  const push = usePush();
  const list = useQuery({ queryKey: ['conversations'], queryFn: chatApi.list });
  const conversations = list.data?.items ?? [];

  return (
    <Screen tab scroll={false} title="Ask Glazion" subtitle="Questions about glazes, materials and firing." action={<Button label="New" icon="plus" kind="secondary" small onPress={() => push('/conversation/new')} />}>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Empty icon="alert-circle" title="Couldn’t load your conversations" text={errorMessage(list.error)} action={<Button label="Try again" kind="secondary" onPress={() => list.refetch()} />} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onRefresh={() => list.refetch()}
          refreshing={list.isRefetching}
          ListEmptyComponent={
            <Empty icon="message-circle" title="No conversations yet" text="Ask about a glaze fault, a material, or have Glazion search the tile library for you." action={<Button label="Start a conversation" onPress={() => push('/conversation/new')} />} />
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => push(`/conversation/${item.id}`)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.sunken }]}>
              <View style={{ flex: 1 }}>
                <Text variant="strong" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text variant="small">{relativeTime(item.updatedAt)}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.ink3} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl, paddingTop: space.sm, gap: space.sm, flexGrow: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14 },
});
