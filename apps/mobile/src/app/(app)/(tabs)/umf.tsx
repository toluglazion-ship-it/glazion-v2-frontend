import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { errorMessage } from '@glazion/api-client';
import { limitStatus, recipeToText, retotal, sameRecipe, skippedReason, totalOf, type RecipeDraft, type SavedRecipe } from '@glazion/api-client/recipes';
import { CONE_DATA, limitConeFor, limitConeText, type GlazeLimit, type UmfCalculateResponse } from '@glazion/types';
import PickerModal from '../../../components/PickerModal';
import RecipeRows, { fromRows, newRow, toRows, type Row as RecipeRow } from '../../../components/RecipeRows';
import Screen from '../../../components/Screen';
import { toast } from '../../../components/Toast';
import { Badge, Button, Card, Icon, Input, Notice, Row, Text } from '../../../components/ui';
import { handoff } from '../../../lib/handoff';
import { formatUmf, oxideLabel, warningText } from '../../../lib/labels';
import { useSavedRecipes } from '../../../lib/savedRecipes';
import { useUmfCalculation } from '../../../lib/useUmf';
import { colors, radius, space, textSize } from '../../../theme';

const fixed = (value: number | null | undefined, places: number) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : 'n/a');

const CTE_BAND: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function Total({ label, value, strict, action, onAction }: { label: string; value: number; strict?: boolean; action?: string; onAction?: () => void }) {
  const off = strict && value > 0 && (value < 99 || value > 101);
  return (
    <View style={styles.total}>
      <View>
        <Text variant="small">{label}</Text>
        <Text variant="strong" style={off && { color: colors.warn }}>
          {value.toFixed(2)}%
        </Text>
      </View>
      {action && onAction && <Button label={action} kind="secondary" small onPress={onAction} disabled={value <= 0} />}
    </View>
  );
}

/** One oxide's value with where it sits against the cone's target range. */
function limitText(value: number, limit: GlazeLimit | undefined): string {
  const status = limitStatus(value, limit);
  if (!status || !limit) return formatUmf(value);
  // The range shows either way, not only when it's missed: "0.25  in 0.20–0.60".
  return `${formatUmf(value)}  ${status} ${limit.minUmf.toFixed(2)}–${limit.maxUmf.toFixed(2)}`;
}

/** The UMF in the groups and order the backend sends (R₂O, RO, R₂O₃, RO₂). */
function UmfGroups({ calc }: { calc: UmfCalculateResponse }) {
  return (
    <>
      {(calc.displayGroups ?? [])
        .filter((g) => (g.oxides ?? []).length > 0)
        .map((group) => (
          <View key={group.key ?? group.label} style={{ gap: 2 }}>
            <Text variant="small" style={{ color: colors.ink3 }}>
              {group.label}
            </Text>
            {(group.oxides ?? []).map(({ oxide, value }) => {
              const limit = calc.limits?.find((l) => l.oxide === oxide);
              const status = limitStatus(value, limit);
              return (
                <Row
                  key={oxide}
                  label={oxideLabel(oxide ?? '')}
                  value={<Text style={{ fontSize: textSize.sm, color: status === 'under' || status === 'over' ? colors.warn : colors.ink }}>{limitText(value, limit)}</Text>}
                />
              );
            })}
          </View>
        ))}
    </>
  );
}

export default function UmfCalculator() {
  const router = useRouter();
  const saved = useSavedRecipes();

  const [name, setName] = useState('');
  const [cone, setCone] = useState('6');
  const [base, setBase] = useState<RecipeRow[]>(() => [newRow()]);
  const [colourants, setColourants] = useState<RecipeRow[]>([]);
  /** The saved recipe this one came from, if any; saving again overwrites it. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const baseTotal = totalOf(base);
  const colourantTotal = totalOf(colourants);
  const overallTotal = baseTotal + colourantTotal;

  // Every number on this screen comes from the backend's calculator, so it needs a connection.
  // The backend has target ranges for a few cones only; any other is compared with the nearest of those.
  const limitCone = limitConeFor(cone);
  const [pickingCone, setPickingCone] = useState(false);
  const { calc, keys, updating, error, offline, refetch } = useUmfCalculation([...base, ...colourants], limitCone);
  const result = calc?.result ?? null;
  const hasUmf = !!result && result.fluxSum > 0;
  const suggestions = result?.suggestions ?? [];
  const molePct = useMemo(
    () => Object.entries(result?.molePct ?? {}).filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] !== 0).sort((a, b) => b[1] - a[1]),
    [result],
  );

  const notes = useMemo(() => {
    const out: Record<number, ReactNode> = {};
    for (const skipped of calc?.skippedRows ?? []) {
      const key = keys[skipped.index];
      if (key !== undefined) out[key] = skippedReason(skipped.reason);
    }
    return out;
  }, [calc, keys]);

  const draft = useMemo<RecipeDraft>(
    () => ({ name, cone, base: fromRows(base), colourants: fromRows(colourants), materialsVersion: calc?.materialsVersion ?? null }),
    [name, cone, base, colourants, calc],
  );
  const stored = saved.recipes.find((recipe) => recipe.id === savedId);
  const hasRows = [...base, ...colourants].some((row) => row.material !== '');
  const upToDate = !!stored && sameRecipe(draft, stored);

  async function handleSave() {
    const recipe = await saved.save(draft, savedId ?? undefined);
    setSavedId(recipe.id);
    setName(recipe.name);
    toast('Recipe saved');
  }

  async function handleDuplicate() {
    const copy = await saved.save({ ...draft, name: `${name.trim() || 'Untitled recipe'} (copy)` });
    setSavedId(copy.id);
    setName(copy.name);
    toast('Saved a copy');
  }

  function open(recipe: SavedRecipe) {
    setName(recipe.name);
    setCone(CONE_DATA.some((data) => data.cone === recipe.cone) ? recipe.cone : '6');
    setBase(recipe.base.length > 0 ? toRows(recipe.base) : [newRow()]);
    setColourants(toRows(recipe.colourants));
    setSavedId(recipe.id);
  }

  function startNew() {
    setName('');
    setBase([newRow()]);
    setColourants([]);
    setSavedId(null);
  }

  function confirmDelete(recipe: SavedRecipe) {
    Alert.alert('Delete this recipe?', `“${recipe.name}” will be removed from this phone.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await saved.remove(recipe.id);
          startNew();
          toast('Recipe deleted');
        },
      },
    ]);
  }

  const offlineText = 'You’re offline. The calculator works on Glazion’s server, so it needs an internet connection. Your recipe is kept; the analysis comes back when you reconnect.';

  let analysis: ReactNode;
  if (error && !calc) {
    analysis = (
      <>
        <Notice tone={offline ? 'warn' : 'bad'} icon={offline ? 'wifi-off' : undefined}>
          {offline ? offlineText : errorMessage(error)}
        </Notice>
        <Button label="Try again" kind="secondary" small onPress={() => refetch()} style={{ alignSelf: 'flex-start' }} />
      </>
    );
  } else if (!result) {
    analysis = <Text variant="muted">{updating ? 'Working it out…' : 'Add materials and amounts to see the analysis.'}</Text>;
  } else {
    analysis = (
      <>
        {error && (
          <Notice tone="warn" icon={offline ? 'wifi-off' : undefined}>
            {offline ? 'You’re offline, so this is the last result. It updates when you reconnect.' : `${errorMessage(error)} This is the last result.`}
          </Notice>
        )}

        {[...new Set((result.warnings ?? []).map(warningText).filter((text): text is string => text !== null))].map((warning) => (
          <Notice key={warning} tone="warn">
            {warning}
          </Notice>
        ))}

        <Text variant="label" style={{ color: colors.ink2 }}>
          UMF (flux to 1){updating ? '  ·  updating' : ''}
        </Text>
        {calc && <UmfGroups calc={calc} />}

        <View style={styles.divider} />
        <Text variant="label" style={{ color: colors.ink2 }}>
          Key ratios
        </Text>
        <View>
          <Row label="SiO₂ : Al₂O₃" value={fixed(result.ratios?.si_al, 2)} />
          <Row label="(KNaLi) / (CaMgBaSrZn)" value={fixed(result.ratios?.alkali_over_alkaline, 2)} />
          <Row label="B₂O₃ %" value={fixed(result.ratios?.b2o3_pct, 2)} />
          <Row label="CTE (×10⁻⁷/°C)" value={`${result.cte.toFixed(1)}${calc?.cteBand ? `  ·  ${CTE_BAND[calc.cteBand] ?? calc.cteBand}` : ''}`} strong />
        </View>

        {result.clayBodyNote && (
          <View style={styles.note}>
            <Text variant="label">Clay body matching</Text>
            <Text style={{ fontSize: textSize.sm }}>{result.clayBodyNote}</Text>
          </View>
        )}

        {(calc?.limits ?? []).length > 0 && hasUmf && (
          <>
            <Text variant="label" style={{ color: colors.ink2 }}>
              Suggestions for {limitConeText(cone)}
            </Text>
            {suggestions.length === 0 ? (
              <Notice tone="ok">Every oxide is inside its target range for {limitConeText(cone)}.</Notice>
            ) : (
              suggestions.map((s) => {
                const under = s.direction === 'increase';
                const first = s.materials?.[0]?.name;
                return (
                  <View key={s.oxide} style={styles.suggestion}>
                    <View style={styles.between}>
                      <Text variant="strong" style={{ flex: 1, fontSize: textSize.sm }}>
                        {oxideLabel(s.oxide ?? '')} is {under ? 'under' : 'over'} {s.target}
                        {first ? `: ${under ? 'add' : 'reduce'} ${first}` : ''}
                      </Text>
                      <Badge label={under ? 'Increase' : 'Decrease'} tone={under ? 'ok' : 'bad'} />
                    </View>
                    <Text variant="small">
                      Now {formatUmf(s.current)}. {under ? 'Materials' : 'Cut back on materials'} high in {oxideLabel(s.oxide ?? '')}:
                    </Text>
                    {(s.materials ?? []).map((m) => (
                      <Row key={m.name} label={m.inRecipe ? `${m.name} (in recipe)` : (m.name ?? '')} value={`${m.oxideContent.toFixed(1)}%`} />
                    ))}
                    {s.notes ? <Text variant="small">{s.notes}</Text> : null}
                  </View>
                );
              })
            )}
          </>
        )}

        {molePct.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text variant="label" style={{ color: colors.ink2 }}>
              Mole %
            </Text>
            <View>
              {molePct.map(([oxide, value]) => (
                <Row key={oxide} label={oxideLabel(oxide)} value={value.toFixed(2)} />
              ))}
            </View>
          </>
        )}

        {hasUmf && result.umf && (
          <Button
            label="Find tiles like this recipe"
            icon="search"
            onPress={() => {
              // The recipe rather than only its UMF, so the search keeps the stains a UMF can't show.
              handoff.startSearch({ rows: [...fromRows(base), ...fromRows(colourants)].filter((row) => row.material !== ''), cone });
              router.navigate('/');
            }}
          />
        )}
      </>
    );
  }

  return (
    <Screen tab title="UMF calculator" subtitle="Build a recipe and see its Unity Molecular Formula as you type.">
      <Card>
        <Text variant="label">Recipe name</Text>
        <Input value={name} onChangeText={setName} placeholder="Untitled recipe" maxLength={80} accessibilityLabel="Recipe name" />
        <View style={styles.actions}>
          <Button label={upToDate ? 'Saved' : 'Save'} small onPress={handleSave} disabled={!hasRows || upToDate} />
          <Button label="Duplicate" kind="secondary" small onPress={handleDuplicate} disabled={!stored} />
          <Button label="Share" icon="share" kind="secondary" small onPress={() => Share.share({ message: recipeToText(draft, calc) })} disabled={!hasRows} />
        </View>
        <View style={styles.actions}>
          <Button label={`Saved recipes${saved.recipes.length > 0 ? ` (${saved.recipes.length})` : ''}`} kind="ghost" small onPress={() => setShowSaved(true)} disabled={saved.recipes.length === 0} />
          <Button label="New" icon="plus" kind="ghost" small onPress={startNew} disabled={!hasRows && !savedId && name === ''} />
          {stored && <Button label="Delete" icon="trash-2" kind="ghost" small onPress={() => confirmDelete(stored)} />}
        </View>
        <Text variant="small">Recipes are saved on this phone for now.</Text>
      </Card>

      <Card>
        <Pressable accessibilityRole="button" accessibilityLabel={`Firing cone, cone ${cone}`} onPress={() => setPickingCone(true)} style={styles.select}>
          <View style={{ flex: 1 }}>
            <Text variant="small">Firing cone</Text>
            <Text variant="strong">Cone {cone}</Text>
          </View>
          <Icon name="chevron-down" size={18} color={colors.ink3} />
        </Pressable>
        <Text variant="small">
          {limitCone === cone
            ? 'Used for the target ranges in the suggestions.'
            : `There are no target ranges for cone ${cone} yet, so the suggestions use cone ${limitCone}’s, the nearest.`}
        </Text>
      </Card>

      <Card>
        <Text variant="heading">Base glaze</Text>
        <RecipeRows rows={base} onChange={setBase} notes={notes} addLabel="Add base material" keepOne />
        <Total label="Base total" value={baseTotal} strict action="Retotal to 100" onAction={() => setBase(retotal(base, baseTotal))} />
      </Card>

      <Card>
        <View>
          <Text variant="heading">Colorants</Text>
          <Text variant="small">Metallic oxides and stains, added as % over base</Text>
        </View>
        <RecipeRows rows={colourants} onChange={setColourants} notes={notes} addLabel="Add colorant" />
        {/* Colorants are added on top of a base of 100, so neither they nor the overall total are retotalled (as on the web). */}
        {colourants.length > 0 && <Total label="Colorants added" value={colourantTotal} />}
      </Card>

      {/* With no colorants it would only repeat the base total. */}
      {colourants.length > 0 && (
        <Card>
          <Total label="Overall total (base + colorants)" value={overallTotal} />
        </Card>
      )}

      <Card>
        <Text variant="heading">Chemistry analysis</Text>

        {analysis}
      </Card>

      <PickerModal
        visible={pickingCone}
        title="Firing cone"
        options={CONE_DATA.map((data) => ({ value: data.cone, label: `Cone ${data.cone}  ·  ${data.celsius} °C` }))}
        value={cone}
        onSelect={setCone}
        onClose={() => setPickingCone(false)}
      />

      <PickerModal
        visible={showSaved}
        title="Saved recipes"
        options={saved.recipes.map((recipe) => ({ value: recipe.id, label: `${recipe.name}  ·  cone ${recipe.cone}` }))}
        value={savedId ?? ''}
        onSelect={(id) => {
          const recipe = saved.recipes.find((r) => r.id === id);
          if (recipe) open(recipe);
        }}
        onClose={() => setShowSaved(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  divider: { height: 1, backgroundColor: colors.line },
  note: { gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  suggestion: { gap: 4, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.lineStrong },
  select: { minHeight: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.md, backgroundColor: colors.surface },
});
