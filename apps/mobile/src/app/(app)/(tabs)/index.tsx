import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { searchProblem, usesSampleData } from '@glazion/api-client/main';
import { amountOf, totalOf } from '@glazion/api-client/recipes';
import { CLAY_BODIES, CONE_DATA, coneToNumber, type Atmosphere, type RecipeImageSearchRequest, type Umf } from '@glazion/types';
import { lookUpMaterial } from '../../../components/MaterialPickerModal';
import PickerModal from '../../../components/PickerModal';
import RecipeRows, { newRow, toRows, type Row, type RowFlag } from '../../../components/RecipeRows';
import Screen from '../../../components/Screen';
import { Button, Card, Chip, Icon, Input, Notice, PreviewNote, Segmented, Text } from '../../../components/ui';
import { handoff } from '../../../lib/handoff';
import { usePush } from '../../../lib/usePush';
import { COLOURS, FLUX_OXIDES, FORMER_OXIDES, OTHER_OXIDES, STABILISER_OXIDES, SURFACES, TILE_VARIANTS, humanise, oxideLabel } from '../../../lib/labels';
import { useSearchHistory } from '../../../lib/searchHistory';
import { lastFiring, searchDraft, type SearchForm } from '../../../lib/searchForm';
import { searchFailure, useRunSearch } from '../../../lib/searchRun';
import { relativeTime } from '../../../lib/time';
import { colors, font, radius, space } from '../../../theme';
import { useIsAdmin } from '../../../lib/access';

type Mode = 'recipe' | 'umf';

/** Leach's 4321 clear, a well-known cone 10 glaze, as an example recipe. */
const EXAMPLE_RECIPE: [string, string][] = [
  ['Custer Feldspar', '40'],
  ['Silica', '30'],
  ['Whiting', '20'],
  ['EPK', '10'],
];

const EXAMPLE_UMF: Umf = { Na2O: 0.18, K2O: 0.12, CaO: 0.52, MgO: 0.18, Al2O3: 0.35, B2O3: 0.2, SiO2: 3.2 };

const NUMBER = /^\d*\.?\d*$/;

const toNumber = (value: string | undefined) => {
  const n = Number((value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Drops zeros and anything that isn't a number, so only real amounts are sent. */
function positive(values: Umf): Umf {
  const out: Umf = {};
  for (const [oxide, value] of Object.entries(values)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[oxide] = value;
  }
  return out;
}

const asText = (values: Umf) => Object.fromEntries(Object.entries(positive(values)).map(([oxide, value]) => [oxide, String(Number(value!.toFixed(3)))]));

const ATMOSPHERES: Atmosphere[] = ['oxidation', 'reduction', 'neutral'];

/** A stored cone or atmosphere, if it's still one the form offers. */
const knownCone = (cone: string | undefined) => (CONE_DATA.some((data) => data.cone === cone) ? cone! : '');
const knownAtmosphere = (value: string | undefined): Atmosphere | '' => ATMOSPHERES.find((a) => a === value) ?? '';

const toFormRow = ({ material, materialId, picked, amount }: Row) => ({ material, materialId, picked, amount });

/** What's wrong with a row that has something in it, if anything. */
function checkRow(row: Row): RowFlag | null {
  if (!row.material) return { key: row.key, field: 'material', message: 'Choose a material from the list for this amount.' };
  if (amountOf(row.amount) <= 0) return { key: row.key, field: 'amount', message: `Give “${row.material}” an amount.` };
  return null;
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** How many recent searches show before "Show all". */
const RECENT_SHOWN = 5;

const CONE_OPTIONS = [{ value: '', label: 'Any cone' }, ...CONE_DATA.map((data) => ({ value: data.cone, label: `Cone ${data.cone}  ·  ${data.celsius} °C` }))];

function ChipGroup({ label, options, selected, onChange }: { label: string; options: { key: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <Chip key={option.key} label={option.label} selected={selected.includes(option.key)} onPress={() => onChange(toggle(selected, option.key))} />
        ))}
      </View>
    </View>
  );
}

export default function FindTiles() {
  const push = usePush();
  const history = useSearchHistory();
  const [allRecent, setAllRecent] = useState(false);

  // Searching by UMF is for admins: everyone else searches with a recipe's materials (the API refuses it too).
  const admin = useIsAdmin();
  const [chosenMode, setMode] = useState<Mode>('recipe');
  const mode: Mode = admin ? chosenMode : 'recipe';
  const [rows, setRows] = useState<Row[]>(() => [newRow(), newRow(), newRow()]);
  const [umf, setUmf] = useState<Record<string, string>>({});
  const [showOthers, setShowOthers] = useState(false);
  const [coneFrom, setConeFrom] = useState('');
  const [coneTo, setConeTo] = useState('');
  const [conePicker, setConePicker] = useState<'from' | 'to' | null>(null);
  const [atmosphere, setAtmosphere] = useState<Atmosphere | ''>('');
  /** Leave out tiles fired differently, rather than only ranking them lower. */
  const [strict, setStrict] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [clayBodies, setClayBodies] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  /** Set when the calculator has just handed over its UMF, which replaced what the form had. */
  const [handedOver, setHandedOver] = useState(false);
  /** The first row the last check stopped at; cleared once that row is changed. */
  const [flag, setFlag] = useState<RowFlag | null>(null);
  /** The rows of the last recipe sent, in order, so the backend's positions point at the right row. */
  const sent = useRef<{ key: number; material: string }[]>([]);

  const form = useMemo<SearchForm>(
    () => ({ mode, rows: rows.map(toFormRow), umf, coneFrom, coneTo, atmosphere, strict, variants, surfaces, colours, clayBodies }),
    [mode, rows, umf, coneFrom, coneTo, atmosphere, strict, variants, surfaces, colours, clayBodies],
  );
  const latestForm = useRef(form);
  latestForm.current = form;
  /** The form before anything was changed, to tell whether the stored one may still replace it. */
  const [untouched] = useState(() => JSON.stringify(form));
  const [restored, setRestored] = useState(false);

  function applyForm(next: SearchForm) {
    setMode(next.mode);
    setRows(next.rows.length > 0 ? next.rows.map((row) => ({ ...newRow(), ...row })) : [newRow(), newRow(), newRow()]);
    setUmf(next.umf);
    setConeFrom(knownCone(next.coneFrom));
    setConeTo(knownCone(next.coneTo));
    setAtmosphere(knownAtmosphere(next.atmosphere));
    setStrict(next.strict);
    setVariants(next.variants);
    setSurfaces(next.surfaces);
    setColours(next.colours);
    setClayBodies(next.clayBodies);
    setFlag(null);
    setProblem('');
  }

  // The form as it was left, even if the app was closed since; or else the firing of the last search.
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await searchDraft.read();
      const firing = stored ? null : await lastFiring.read();
      // Something typed (or handed over) meanwhile wins.
      if (active && JSON.stringify(latestForm.current) === untouched) {
        if (stored) applyForm(stored);
        else if (firing) {
          setConeFrom(knownCone(firing.coneFrom));
          setConeTo(knownCone(firing.coneTo));
          setAtmosphere(knownAtmosphere(firing.atmosphere));
        }
      }
      if (active) setRestored(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (restored) void searchDraft.write(form);
  }, [form, restored]);

  // The calculator can hand over its recipe (or a UMF) and cone to start from, and a past search can come back to be edited.
  useFocusEffect(
    useCallback(() => {
      const edit = handoff.takeSearchToEdit();
      if (edit) return applyForm(edit);
      const start = handoff.takeSearchStart();
      if (!start) return;
      setHandedOver(true);
      if (start.rows?.length) {
        setMode('recipe');
        setRows(toRows(start.rows));
      } else if (start.umf) {
        setMode('umf');
        setUmf(asText(start.umf));
      }
      setConeFrom(start.cone);
      setConeTo(start.cone);
    }, []),
  );

  const run = useRunSearch();
  const queryClient = useQueryClient();
  const [filling, setFilling] = useState(false);
  // The examples only fill an empty form, so they never replace what's been typed.
  const rowsEmpty = rows.every((row) => !row.material && !row.amount);

  async function fillExampleRecipe() {
    setFilling(true);
    // Each material picked from the list, as if chosen by hand; one that can't be found is left out.
    const found = await Promise.all(
      EXAMPLE_RECIPE.map(async ([name, amount]) => {
        const material = await lookUpMaterial(queryClient, name).catch(() => undefined);
        return material ? { ...newRow(), material: material.name, materialId: material.id ?? null, picked: true, amount } : null;
      }),
    );
    setRows(found.filter((row): row is Row => row !== null));
    setFilling(false);
  }

  /** Divides every oxide by the flux total, so the fluxes add up to 1 as a unity formula should. */
  function scaleToUnity() {
    setUmf((prev) => asText(Object.fromEntries(Object.entries(prev).map(([oxide, raw]) => [oxide, toNumber(raw) / fluxTotal]))));
  }

  const total = totalOf(rows);
  const fluxTotal = FLUX_OXIDES.reduce((sum, oxide) => sum + toNumber(umf[oxide]), 0);
  const silica = toNumber(umf.SiO2);
  const alumina = toNumber(umf.Al2O3);
  const offUnity = fluxTotal > 0 && Math.abs(fluxTotal - 1) > 0.02;
  const umfEntered = Object.values(umf).some((value) => value.trim() !== '');
  const filterCount = clayBodies.length + variants.length + surfaces.length + colours.length;
  const rejection = run.isError ? searchProblem(run.error) : null;

  // A recipe the backend turned down: what each unrecognised row may have meant, under that row.
  const notes = useMemo(() => {
    const out: Record<number, ReactNode> = {};
    if (rejection?.code !== 'materials_unresolved') return out;
    for (const r of rejection.resolutions) {
      // The API counts rows from 1.
      const row = sent.current[r.position - 1];
      if (row === undefined || r.status === 'resolved') continue;
      const key = row.key;
      // Gone once the row has been changed.
      if (rows.find((current) => current.key === key)?.material !== row.material) continue;
      out[key] = (
        <View style={{ gap: 4 }}>
          <Text variant="small" style={{ color: colors.bad }}>
            {r.status === 'invalid_amount' ? `Give “${r.rawName}” an amount.` : `“${r.rawName}” isn’t in the materials list.`}
            {r.suggestions.length > 0 ? ' Did you mean:' : ''}
          </Text>
          {r.suggestions.length > 0 && (
            <View style={styles.chips}>
              {r.suggestions.map((sug) => (
                <Chip
                  key={sug.materialId ?? sug.name}
                  label={sug.name}
                  onPress={() => setRows((prev) => prev.map((row) => (row.key === key ? { ...row, material: sug.name, materialId: sug.materialId, picked: true } : row)))}
                />
              ))}
            </View>
          )}
        </View>
      );
    }
    return out;
  }, [rejection, rows]);
  const visibleOthers = useMemo(() => showOthers || OTHER_OXIDES.some((oxide) => toNumber(umf[oxide]) > 0), [showOthers, umf]);

  function handleSubmit() {
    if (run.isPending) return;

    let query: RecipeImageSearchRequest['query'];
    let label: string;
    if (mode === 'recipe') {
      // The backend works out the chemistry from the materials' ids; nothing is calculated here.
      const used = rows.filter((row) => row.material !== '' || row.amount !== '');
      const wrong = used.map(checkRow).find(Boolean);
      if (wrong) {
        setProblem('');
        return setFlag(wrong);
      }
      setFlag(null);
      if (used.length === 0) return setProblem('Choose at least one material and give it an amount.');
      sent.current = used.map(({ key, material }) => ({ key, material }));
      const names = used.map((row) => row.material.trim());
      label = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ');
      query = {
        type: 'raw_recipe',
        materials: used.map((row) => ({
          ...(row.materialId ? { materialId: row.materialId } : { rawName: row.material }),
          amount: amountOf(row.amount),
          unit: '%' as const,
        })),
      };
    } else {
      const values = positive(Object.fromEntries(Object.entries(umf).map(([oxide, raw]) => [oxide, toNumber(raw)])));
      setFlag(null);
      if (Object.keys(values).length === 0) return setProblem('Enter at least one oxide amount.');
      query = { type: 'umf', umf: values };
      label = `UMF · ${['SiO2', 'Al2O3', 'B2O3'].filter((oxide) => values[oxide]).map((oxide) => `${oxideLabel(oxide)} ${values[oxide]}`).join(' · ') || `${Object.keys(values).length} oxides`}`;
    }
    setProblem('');
    void lastFiring.write({ coneFrom, coneTo, atmosphere });

    // Accept the range in either order.
    const cones = [coneFrom, coneTo].filter(Boolean).map(coneToNumber).sort((a, b) => a - b);
    const filters = {
      ...(clayBodies.length > 0 && { clayBodies }),
      ...(variants.length > 0 && { tileVariantKeys: variants }),
      ...(surfaces.length > 0 && { surface: surfaces }),
      ...(colours.length > 0 && { colourFamily: colours }),
    };

    run.mutate({
      request: {
        query,
        firing: {
          coneMin: cones[0] ?? null,
          coneMax: cones[cones.length - 1] ?? null,
          atmosphere: atmosphere || null,
          ...(strict && (cones.length > 0 || atmosphere) && { strict: true }),
        },
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        topK: 12,
        // Without it results come back without their lab codes.
        includeRecipeMetadata: true,
      },
      label,
      form,
    });
  }

  function changeRows(next: Row[]) {
    // Rows that weren't touched keep their object, so a changed flagged row is easy to spot.
    if (flag && next.find((row) => row.key === flag.key) !== rows.find((row) => row.key === flag.key)) setFlag(null);
    setRows(next);
  }

  const oxideInputs = (oxides: string[]) => (
    <View style={styles.oxides}>
      {oxides.map((oxide) => (
        <View key={oxide} style={styles.oxide}>
          <Text variant="small" style={{ fontFamily: font.semibold }}>
            {oxideLabel(oxide)}
          </Text>
          <Input
            value={umf[oxide] ?? ''}
            onChangeText={(text) => {
              // Numbers only, as in the amount fields; a comma counts as the decimal point.
              const value = text.replace(',', '.');
              if (NUMBER.test(value)) setUmf((prev) => ({ ...prev, [oxide]: value }));
              setHandedOver(false);
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            accessibilityLabel={oxide}
            style={styles.oxideInput}
          />
        </View>
      ))}
    </View>
  );

  let turnedDown = '';
  if (rejection?.code === 'zero_flux')
    turnedDown =
      mode === 'umf'
        ? 'This UMF has no flux, so it can’t be compared. Enter at least one of the fluxes.'
        : 'This recipe has no flux, so its chemistry can’t be compared. Add a flux such as a feldspar, whiting or a frit.';
  else if (rejection?.code === 'materials_unresolved') turnedDown = 'Some materials weren’t recognised. Pick a suggestion under the row, or choose the material again.';
  const failure = run.isError && !rejection ? searchFailure(run.error) : null;
  // A flagged row's message shows under the row and here by the button, which may be all that's in view.
  const rowProblem = mode === 'recipe' ? flag?.message : undefined;
  const error = rowProblem || problem || turnedDown || failure?.message || '';
  const hasFiring = coneFrom !== '' || coneTo !== '' || atmosphere !== '';
  const recent = allRecent ? history.searches : history.searches.slice(0, RECENT_SHOWN);

  return (
    <Screen
      tab
      title="Find tiles"
      subtitle="See real fired tiles close to your glaze."
      footer={
        <>
          {error !== '' && <Notice>{error}</Notice>}
          <Button label="Find tiles" icon="search" onPress={handleSubmit} loading={run.isPending} loadingLabel="Finding tiles…" />
        </>
      }
    >
      {usesSampleData('search') && <PreviewNote>Search isn’t connected to the tile library yet. Results are placeholders to show how it will work.</PreviewNote>}

      <Card>
        {admin && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'recipe', label: 'Recipe' },
              { value: 'umf', label: 'UMF' },
            ]}
          />
        )}

        {mode === 'recipe' ? (
          <>
            {handedOver && <Notice tone="info">Recipe from the calculator loaded, with its cone. It replaced what was in the materials.</Notice>}
            <View style={styles.between}>
              <Text variant="label" accessibilityRole="header">Materials</Text>
              <Text variant="small">Parts by weight · total {Number(total.toFixed(2))}</Text>
            </View>
            <RecipeRows rows={rows} onChange={changeRows} notes={notes} flag={mode === 'recipe' ? flag : null} addLabel="Add material" keepOne />
            {rowsEmpty && (
              <Button label="Fill in an example: Leach 4321 clear" kind="ghost" small onPress={fillExampleRecipe} loading={filling} loadingLabel="Filling in…" style={{ alignSelf: 'flex-start' }} />
            )}
          </>
        ) : (
          <>
            {handedOver && <Notice tone="info">UMF from the calculator loaded, with its cone. It replaced what was in the UMF form.</Notice>}
            {/* Each group's name sits with its own fields, and the groups have room between them. */}
            <View style={styles.group}>
              <View style={styles.between}>
                <Text variant="label" accessibilityRole="header">
                  Fluxes
                </Text>
                <Text variant="small">In a UMF these add up to 1</Text>
              </View>
              {oxideInputs(FLUX_OXIDES)}
            </View>
            <View style={styles.group}>
              <Text variant="label" accessibilityRole="header">
                Stabilisers
              </Text>
              {oxideInputs(STABILISER_OXIDES)}
            </View>
            <View style={styles.group}>
              <Text variant="label" accessibilityRole="header">
                Glass former
              </Text>
              {oxideInputs(FORMER_OXIDES)}
            </View>

            {visibleOthers ? (
              <View style={styles.group}>
                <Text variant="label" accessibilityRole="header">
                  Colorants (metallic oxides) and other oxides
                </Text>
                {oxideInputs(OTHER_OXIDES)}
              </View>
            ) : (
              <Button label="Colorants (metallic oxides) and other oxides" icon="plus" kind="ghost" small onPress={() => setShowOthers(true)} style={{ alignSelf: 'flex-start' }} />
            )}

            <View style={styles.readouts}>
              <View>
                <Text variant="small">Flux total</Text>
                <Text variant="strong" style={offUnity && { color: colors.warn }}>
                  {fluxTotal.toFixed(2)}
                </Text>
              </View>
              <View>
                <Text variant="small">Silica : alumina</Text>
                <Text variant="strong">{silica > 0 && alumina > 0 ? `${(silica / alumina).toFixed(1)} : 1` : '—'}</Text>
              </View>
              {/* Only on an empty UMF, so it can't replace values someone has typed. */}
              {!umfEntered && <Button label="Fill in an example" kind="ghost" small onPress={() => setUmf(asText(EXAMPLE_UMF))} style={{ marginLeft: 'auto' }} />}
            </View>
            {offUnity && (
              <>
                <Text variant="small">The fluxes don’t add up to 1, so this may not be a unity formula. Scale it so they do, or search with it as it is.</Text>
                <Button label="Scale fluxes to 1" kind="secondary" small onPress={scaleToUnity} style={{ alignSelf: 'flex-start' }} />
              </>
            )}
          </>
        )}
      </Card>

      <Card>
        <Text variant="label" accessibilityRole="header">Firing</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(['from', 'to'] as const).map((which) => {
            const value = which === 'from' ? coneFrom : coneTo;
            return (
              <Pressable key={which} accessibilityRole="button" onPress={() => setConePicker(which)} style={styles.select}>
                <View style={{ flex: 1 }}>
                  <Text variant="small">Cone {which}</Text>
                  <Text variant="strong">{value || 'Any'}</Text>
                </View>
                {/* It opens a list: the chevron says so, as on any select. */}
                <Icon name="chevron-down" size={18} color={colors.ink3} />
              </Pressable>
            );
          })}
        </View>
        <Segmented
          value={atmosphere}
          onChange={setAtmosphere}
          options={[
            { value: '', label: 'Any' },
            { value: 'oxidation', label: 'Oxidation' },
            { value: 'reduction', label: 'Reduction' },
            { value: 'neutral', label: 'Neutral' },
          ]}
        />
        {hasFiring && (
          <View style={styles.chips}>
            <Chip label="Only tiles fired this way" selected={strict} onPress={() => setStrict((on) => !on)} />
          </View>
        )}
      </Card>

      {showFilters ? (
        <Card>
          {/* The filters can be cleared in one go, and the card put away again. */}
          <View style={styles.between}>
            <Text variant="label" accessibilityRole="header">
              Narrow the results
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {filterCount > 0 && (
                <Button
                  label="Clear"
                  kind="ghost"
                  small
                  onPress={() => {
                    setClayBodies([]);
                    setVariants([]);
                    setSurfaces([]);
                    setColours([]);
                  }}
                />
              )}
              <Button label="Hide" kind="ghost" small onPress={() => setShowFilters(false)} />
            </View>
          </View>
          <ChipGroup label="Clay body" options={CLAY_BODIES.map((c) => ({ key: c.value, label: c.label }))} selected={clayBodies} onChange={setClayBodies} />
          <ChipGroup label="Body colour" options={TILE_VARIANTS} selected={variants} onChange={setVariants} />
          <ChipGroup label="Surface" options={SURFACES.map((key) => ({ key, label: humanise(key) }))} selected={surfaces} onChange={setSurfaces} />
          <ChipGroup label="Colour" options={COLOURS.map((key) => ({ key, label: humanise(key) }))} selected={colours} onChange={setColours} />
        </Card>
      ) : (
        <Button label={`Narrow the results${filterCount > 0 ? ` (${filterCount})` : ''}`} icon="sliders" kind="ghost" small onPress={() => setShowFilters(true)} style={{ alignSelf: 'flex-start' }} />
      )}

      {/* Only while the form is as it was sent: once it's changed, Find tiles is what runs it. */}
      {failure?.retry && run.variables && !run.isPending && JSON.stringify(run.variables.form) === JSON.stringify(form) && (
        <Button label="Try again" icon="refresh-cw" kind="secondary" onPress={() => run.mutate(run.variables!)} />
      )}

      {history.searches.length > 0 && (
        <Card style={{ paddingHorizontal: 0, paddingVertical: 0, gap: 0 }}>
          <Text variant="label" accessibilityRole="header" style={styles.recentHead}>
            Recent searches
          </Text>
          {recent.map((past) => (
            <Pressable
              key={past.searchId}
              accessibilityRole="button"
              onPress={() => push(`/results/${past.searchId}`)}
              style={({ pressed }) => [styles.recent, pressed && { backgroundColor: colors.canvas }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
                  {past.label}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {[past.firing, past.closest && `Closest: ${past.closest}`, relativeTime(past.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.ink3} />
            </Pressable>
          ))}
          {history.searches.length > RECENT_SHOWN && (
            <Button label={allRecent ? 'Show fewer' : `Show all ${history.searches.length}`} kind="ghost" small onPress={() => setAllRecent((all) => !all)} style={{ alignSelf: 'flex-start', margin: space.sm }} />
          )}
        </Card>
      )}

      <PickerModal
        visible={conePicker !== null}
        title={conePicker === 'to' ? 'Cone to' : 'Cone from'}
        options={CONE_OPTIONS}
        value={conePicker === 'to' ? coneTo : coneFrom}
        onSelect={(value) => (conePicker === 'to' ? setConeTo(value) : setConeFrom(value))}
        onClose={() => setConePicker(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  oxides: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Two to a row, wide enough to read and tap; four each about 70pt wide was cramped.
  oxide: { width: '47%', flexGrow: 1, gap: 4 },
  group: { gap: space.sm, marginTop: space.xs },
  oxideInput: { minHeight: 44, paddingHorizontal: 10, textAlign: 'right', fontVariant: ['tabular-nums'] },
  readouts: { flexDirection: 'row', alignItems: 'center', gap: space.xl, padding: space.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  recentHead: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  select: { flex: 1, minHeight: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.md, backgroundColor: colors.surface },
});
