import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { SavedRow } from '@glazion/api-client/recipes';
import { colors, font, radius, space } from '../theme';
import MaterialPickerModal from './MaterialPickerModal';
import { toast } from './Toast';
import { Button, IconButton, Input, Text } from './ui';

export interface Row {
  key: number;
  material: string;
  /** The material's id in the backend list; null for recipes saved before ids were kept. */
  materialId: string | null;
  /** Always true once a material is set: rows can only be filled from the list or a saved recipe. */
  picked: boolean;
  amount: string;
}

let nextKey = 0;
export const newRow = (): Row => ({ key: nextKey++, material: '', materialId: null, picked: false, amount: '' });

export const toRows = (rows: SavedRow[]): Row[] => rows.map((row) => ({ ...newRow(), material: row.material, materialId: row.materialId ?? null, picked: row.material !== '', amount: row.amount }));
/** The row a form check stopped at, and which of its fields needs fixing. */
export interface RowFlag {
  key: number;
  field: 'material' | 'amount';
  message: string;
}

export const fromRows = (rows: Row[]): SavedRow[] => rows.map(({ material, materialId, amount }) => ({ material, materialId, amount }));

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  addLabel: string;
  /** The base recipe always keeps one row; colorants can be emptied. */
  keepOne?: boolean;
  /** A note under a row, by its key: why the backend left it out, or what it may have meant. */
  notes?: Record<number, ReactNode>;
  /** Marks that row's field, puts the message under it and moves focus there. */
  flag?: RowFlag | null;
}

const AMOUNT = /^\d*\.?\d*$/;

/**
 * A material is always chosen from the list, never typed in, so a recipe can't be calculated with
 * a near-miss name.
 */
export default function RecipeRows({ rows, onChange, addLabel, keepOne = false, notes = {}, flag = null }: Props) {
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const amounts = useRef(new Map<number, TextInput | null>());
  // An Undo pressed seconds later puts the row back into the rows as they are then.
  const latest = useRef({ rows, onChange });
  useEffect(() => {
    latest.current = { rows, onChange };
  });

  function remove(row: Row, index: number) {
    onChange(rows.filter((r) => r.key !== row.key));
    if (!row.material && !row.amount) return;
    toast(`Removed ${row.material || 'a row'}`, {
      action: {
        label: 'Undo',
        onPress: () => {
          const { rows: now, onChange: change } = latest.current;
          if (!now.some((r) => r.key === row.key)) change([...now.slice(0, index), row, ...now.slice(index)]);
        },
      },
    });
  }
  const materials = useRef(new Map<number, View | null>());

  // A new flag each time the form is checked, so pressing the button again brings focus back.
  useEffect(() => {
    if (!flag) return;
    if (flag.field === 'amount') {
      amounts.current.get(flag.key)?.focus();
      return;
    }
    const button = materials.current.get(flag.key);
    if (!button) return;
    // The browser preview focuses the element; on a phone the screen reader moves to it.
    if (Platform.OS === 'web') (button as unknown as HTMLElement).focus?.();
    else {
      const node = findNodeHandle(button);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [flag]);

  function update(key: number, patch: Partial<Row>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  const current = rows.find((row) => row.key === pickingFor);

  return (
    <View style={{ gap: space.sm }}>
      {rows.map((row, index) => {
        const flagged = flag?.key === row.key ? flag : null;
        return (
          <View key={row.key} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Pressable
                ref={(view) => {
                  materials.current.set(row.key, view);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Material ${index + 1}: ${row.material || 'not chosen'}`}
                accessibilityHint={flagged?.field === 'material' ? flagged.message : undefined}
                onPress={() => setPickingFor(row.key)}
                // Red, like the note under it: the row can't be searched as it is.
              style={[styles.material, (!!notes[row.key] || flagged?.field === 'material') && { borderColor: colors.bad }]}
              >
                <Text numberOfLines={1} style={[{ flex: 1 }, !row.material && { color: colors.ink3 }]}>
                  {row.material || 'Choose material'}
                </Text>
              </Pressable>
              <Input
                value={row.amount}
                onChangeText={(text) => {
                  const value = text.replace(',', '.');
                  if (AMOUNT.test(value)) update(row.key, { amount: value });
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                accessibilityLabel={`Amount of material ${index + 1}`}
                accessibilityHint={flagged?.field === 'amount' ? flagged.message : undefined}
                inputRef={(input) => {
                  amounts.current.set(row.key, input);
                }}
                invalid={flagged?.field === 'amount'}
                style={styles.amount}
              />
              <IconButton name="x" label={`Remove material ${index + 1}`} onPress={() => remove(row, index)} disabled={keepOne && rows.length === 1} />
            </View>
            {flagged && (
              <Text variant="small" style={{ color: colors.bad }}>
                {flagged.message}
              </Text>
            )}
            {typeof notes[row.key] === 'string' ? (
              <Text variant="small" style={{ color: colors.bad }}>
                {notes[row.key]}
              </Text>
            ) : (
              notes[row.key]
            )}
          </View>
        );
      })}

      <Button label={addLabel} icon="plus" kind="ghost" small onPress={() => onChange([...rows, newRow()])} style={{ alignSelf: 'flex-start' }} />

      <MaterialPickerModal
        visible={pickingFor !== null}
        value={current?.material ?? ''}
        onSelect={(material) => pickingFor !== null && update(pickingFor, { material: material.name, materialId: material.id, picked: true })}
        onClose={() => setPickingFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // More room before the remove button, so it isn't hit when reaching for the amount.
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, columnGap: space.md },
  material: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.fieldLine,
    borderRadius: radius.md,
  },
  amount: { width: 84, textAlign: 'right', fontFamily: font.medium, fontVariant: ['tabular-nums'] },
});
