import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { errorMessage, materialsApi } from '@glazion/api-client';
import type { MaterialCategoryOption, MaterialSummary } from '@glazion/types';
import { useReducedMotion } from '../lib/motion';
import { useDebounced } from '../lib/useDebounced';
import { colors, font, space } from '../theme';
import { Badge, Icon, IconButton, Input, Text } from './ui';

export interface PickedMaterial {
  id: string | null;
  name: string;
}

interface Props {
  visible: boolean;
  /** The row's current material name, marked in the list. */
  value: string;
  onSelect: (material: PickedMaterial) => void;
  onClose: () => void;
}

type Named = MaterialSummary & { name: string };

/** The one material with exactly this name (or short name, like EPK), in any capitals; for filling in an example. */
export async function lookUpMaterial(queryClient: QueryClient, name: string): Promise<Named | undefined> {
  const found = await queryClient.fetchQuery({ queryKey: ['materials', 'search', name], queryFn: () => materialsApi.search(name, 30), staleTime: 5 * 60_000 });
  const named = (found.items ?? []).filter((m): m is Named => !!m.name);
  const lower = name.toLowerCase();
  const byName = named.filter((m) => m.name.toLowerCase() === lower);
  if (byName.length > 0) return byName.length === 1 ? byName[0] : undefined;
  const byAlias = named.filter((m) => m.matchedAlias?.toLowerCase() === lower);
  return byAlias.length === 1 ? byAlias[0] : undefined;
}
type Item = { kind: 'group'; label: string } | { kind: 'material'; material: Named };

const ROW_HEIGHT = 52;

function categoryLabel(categories: MaterialCategoryOption[] | null | undefined, id: string | null | undefined): string {
  if (!id) return 'Other';
  return categories?.find((c) => c.key === id)?.label ?? id[0].toUpperCase() + id.slice(1);
}

/**
 * Chooses a material from Glazion's list on the server, the one recipes are calculated against.
 * Before anything is typed it shows the studio short list by category; typing searches every
 * material, including the names potters use (EPK, Whiting, RIO). Nothing typed counts as a value.
 */
export default function MaterialPickerModal({ visible, value, onSelect, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim(), 250);
  const searching = term.length > 0;

  const common = useQuery({
    queryKey: ['materials', 'common'],
    queryFn: () => materialsApi.list({ common: true, pageSize: 200 }),
    // Loaded with the screen rather than on first opening, so the list is there straight away.
    enabled: !searching,
    staleTime: 10 * 60_000,
  });
  const found = useQuery({
    queryKey: ['materials', 'search', term],
    queryFn: () => materialsApi.search(term, 30),
    enabled: visible && searching,
    staleTime: 5 * 60_000,
  });

  const active = searching ? found : common;
  const materials = (active.data?.items ?? []).filter((m): m is Named => !!m.name);
  const categories = active.data?.categories ?? common.data?.categories;
  const items: Item[] = [];
  materials.forEach((material, index) => {
    if (!searching && (index === 0 || materials[index - 1].category !== material.category)) items.push({ kind: 'group', label: categoryLabel(categories, material.category) });
    items.push({ kind: 'material', material });
  });
  const waiting = active.isPending || (searching && term !== query.trim());

  function close() {
    setQuery('');
    onClose();
  }

  let empty: string;
  if (waiting) empty = 'Looking…';
  else if (active.isError) empty = active.error instanceof TypeError ? 'You’re offline. The materials list needs an internet connection.' : errorMessage(active.error);
  else empty = searching ? `No material called “${query.trim()}”.` : 'Type to search every material.';

  return (
    // Slides up, unless the phone is set to reduce motion.
    <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text variant="heading">Choose a material</Text>
          <IconButton name="x" label="Close" onPress={close} />
        </View>

        <View style={styles.search}>
          <Input value={query} onChangeText={setQuery} placeholder="Search materials, e.g. EPK" autoCapitalize="none" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
          {!searching && materials.length > 0 && <Text variant="small">The studio short list. Type to search every material.</Text>}
        </View>

        <FlatList
          data={items}
          keyExtractor={(item, index) => (item.kind === 'group' ? `group-${item.label}-${index}` : (item.material.id ?? item.material.name))}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          ListEmptyComponent={
            <Text variant="muted" style={{ padding: space.xl }}>
              {empty}
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === 'group') {
              return (
                <Text variant="small" style={styles.group}>
                  {item.label.toUpperCase()}
                </Text>
              );
            }
            const m = item.material;
            const chosen = m.name === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => {
                  onSelect({ id: m.id, name: m.name });
                  close();
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sunken }]}
              >
                <Text numberOfLines={1} style={[{ flex: 1 }, chosen && { fontFamily: font.semibold }]}>
                  {m.name}
                  {m.matchedAlias ? <Text variant="small"> ({m.matchedAlias})</Text> : null}
                </Text>
                {/* Stains have no analysis by nature; search compares them by name and amount. */}
                {!m.hasAnalysis && (m.category === 'stain' ? <Badge label="Stain" tone="info" /> : <Badge label="No analysis" tone="warn" />)}
                {chosen && <Icon name="check" size={18} color={colors.ok} />}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.xl, paddingRight: space.sm, paddingVertical: space.sm },
  search: { gap: 6, paddingHorizontal: space.xl, paddingBottom: space.md },
  group: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: 4, fontFamily: font.semibold, color: colors.ink3 },
  row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
});
