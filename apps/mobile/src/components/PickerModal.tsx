import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '../lib/motion';
import { colors, font, space } from '../theme';
import { Icon, IconButton, Input, Text } from './ui';

export interface PickerOption {
  value: string;
  label: string;
  /** Lower-cased label, precomputed for long lists. */
  lower?: string;
}

interface Props {
  visible: boolean;
  title: string;
  options: PickerOption[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  /** Adds a search box. Matches that start with the search come first, then the rest, alphabetically. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

const ROW_HEIGHT = 48;

/** A full-screen list to choose one option from. Nothing can be typed in as a value. */
export default function PickerModal({ visible, title, options, value, onSelect, onClose, searchable, searchPlaceholder }: Props) {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    const lower = (o: PickerOption) => o.lower ?? o.label.toLowerCase();
    return options
      .filter((o) => lower(o).includes(q))
      .sort((a, b) => {
        const aStarts = lower(a).startsWith(q);
        const bStarts = lower(b).startsWith(q);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [options, query]);

  function close() {
    setQuery('');
    onClose();
  }

  return (
    // Slides up, unless the phone is set to reduce motion.
    <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text variant="heading">{title}</Text>
          <IconButton name="x" label="Close" onPress={close} />
        </View>

        {searchable && (
          <View style={styles.search}>
            <Input value={query} onChangeText={setQuery} placeholder={searchPlaceholder} autoCapitalize="none" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
          </View>
        )}

        <FlatList
          data={shown}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          ListEmptyComponent={
            <Text variant="muted" style={{ padding: space.xl }}>
              Nothing matches “{query.trim()}”.
            </Text>
          }
          renderItem={({ item }) => {
            const chosen = item.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => {
                  onSelect(item.value);
                  close();
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sunken }]}
              >
                <Text numberOfLines={1} style={[{ flex: 1 }, chosen && { fontFamily: font.semibold }]}>
                  {item.label}
                </Text>
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
  search: { paddingHorizontal: space.xl, paddingBottom: space.md },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
});
