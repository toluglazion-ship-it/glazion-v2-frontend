import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { isSearchGone, searchApi, usesSampleData } from '@glazion/api-client/main';
import type { ColorantMaterial, RecipeImageSearchResponse, SearchResultItem } from '@glazion/types';
import TileImage from '../../../components/TileImage';
import { Badge, Button, Card, Chip, Empty, Icon, Notice, PreviewNote, Text, TileSkeleton } from '../../../components/ui';
import { BAND, COLORANT_KIND, COLORANT_OXIDES, FLUX_OXIDES, FORMER_OXIDES, OTHER_OXIDES, STABILISER_OXIDES, formatUmf, humanise, oxideLabel, percent, recipeNameUnderCode, resultName, tileAlt, tileFacts, warningText } from '../../../lib/labels';
import { handoff } from '../../../lib/handoff';
import { usePush } from '../../../lib/usePush';
import { useSearchHistory, type PastSearch } from '../../../lib/searchHistory';
import { searchFailure, useRunSearch } from '../../../lib/searchRun';
import { colors, font, radius, space, textSize } from '../../../theme';

/** Fresh image links at most this often, so an image that can't load doesn't ask again and again. */
const REFRESH_GAP = 30_000;

export default function Results() {
  const { searchId } = useLocalSearchParams<{ searchId: string }>();
  const router = useRouter();
  const push = usePush();
  const history = useSearchHistory();
  const [showAll, setShowAll] = useState(false);
  const lastRefresh = useRef(0);
  const again = useRunSearch({ replace: true });

  // How this search was run, from the recent list. Kept once seen, since a search that's gone comes off
  // that list but can still be run again.
  const seen = useRef<PastSearch | undefined>(undefined);
  seen.current = history.searches.find((past) => past.searchId === searchId) ?? seen.current;
  const past = seen.current;

  /** Back to the form, filled in as it was when it has that; otherwise just the form. */
  function changeSearch() {
    if (past?.form) handoff.editSearch(past.form);
    router.navigate('/');
  }

  // Already in the cache when arriving from the search form; fetched when opened from chat or the
  // recent list. Image links are signed and expire, so an older search is fetched again for fresh ones.
  const search = useQuery({ queryKey: ['search', searchId], queryFn: () => searchApi.getOne(searchId), staleTime: 5 * 60_000 });

  // A search the API no longer has for this user comes off the recent list.
  const gone = search.isError && isSearchGone(search.error);
  // Runs once when the search turns out to be gone; history.remove is a new function every render.
  useEffect(() => {
    if (gone) void history.remove(searchId);
  }, [gone, searchId]);

  const { refetch } = search;
  const refreshImages = useCallback(() => {
    if (Date.now() - lastRefresh.current < REFRESH_GAP) return;
    lastRefresh.current = Date.now();
    void refetch();
  }, [refetch]);

  // The closest match's outline while it loads, so the results don't jump in.
  if (search.isPending) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <TileSkeleton label="Loading the results" />
      </ScrollView>
    );
  }
  if (search.isError) {
    const failed = again.isError ? searchFailure(again.error) : null;
    return (
      <Empty
        icon="alert-circle"
        title="This search isn’t available"
        text={
          failed?.message ??
          (gone ? `It may have been run on another account, or it no longer exists. ${past?.request ? 'Run it again to see results.' : 'Search again to see results.'}` : errorMessage(search.error))
        }
        action={
          <View style={styles.actions}>
            {gone && past?.request ? (
              <Button label="Run it again" icon="refresh-cw" onPress={() => again.mutate({ request: past.request!, label: past.label, form: past.form })} loading={again.isPending} loadingLabel="Finding tiles…" />
            ) : !gone ? (
              <Button label="Try again" icon="refresh-cw" onPress={() => search.refetch()} />
            ) : null}
            <Button label={past?.form ? 'Edit search' : 'Back to Find tiles'} kind="secondary" onPress={changeSearch} />
          </View>
        }
      />
    );
  }

  const data = search.data;
  const best = data.closestMatch;
  const more = data.items.filter((item) => item.imageId !== best?.imageId);
  const open = (item: SearchResultItem) => push(`/result/${searchId}/${item.imageId}`);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {usesSampleData('search') && <PreviewNote>These tiles and scores are placeholders.</PreviewNote>}

      {past && (
        <View style={styles.searched}>
          <Text variant="small" style={{ flex: 1 }}>
            Searched: <Text variant="small" style={{ fontFamily: font.semibold, color: colors.ink }}>{past.label}</Text>
            {` · ${past.firing || 'Any firing'}${past.filters ? ` · ${past.filters}` : ''}`}
          </Text>
          {past.form && <Button label="Edit search" icon="edit-2" kind="secondary" small onPress={changeSearch} />}
        </View>
      )}

      {/* Weak matches are never shown as if they were answers: with no_reliable_match, say so instead. */}
      {!best || data.warnings.includes('no_reliable_match') ? (
        <Card>
          <Empty
            icon="image"
            title="No close match in the collection yet"
            text="No photographed tile is close enough to this glaze and firing to be worth showing. Try widening the cone range or removing a filter."
            action={<Button label="Change search" icon="sliders" kind="secondary" onPress={changeSearch} />}
          />
        </Card>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Closest match: ${tileAlt(best)}. ${percent(best.score)}, ${BAND[best.confidenceBand].label.toLowerCase()}.`} onPress={() => open(best)} style={({ pressed }) => [styles.closest, pressed && { opacity: 0.9 }]}>
          <View>
            <TileImage uri={best.displayUrl} cacheKey={best.imageId} style={styles.closestImage} onError={refreshImages} flagLowRes />
            {/* Said on the photo as on the cards, not only to screen readers. */}
            {best.resultType === 'synthetic_preview' && (
              <View style={styles.flag}>
                <Text style={styles.flagText}>Generated preview, not a real tile</Text>
              </View>
            )}
          </View>
          <View style={styles.closestBody}>
            <Text variant="small">Closest match</Text>
            {best.source.recipeCode ? <Text style={styles.codeLarge}>{best.source.recipeCode}</Text> : <Text variant="heading">{resultName(best)}</Text>}
            {recipeNameUnderCode(best) && <Text variant="strong">{recipeNameUnderCode(best)}</Text>}
            <View style={styles.scoreRow}>
              <Text style={styles.scoreLarge}>{percent(best.score)}</Text>
              <Badge label={BAND[best.confidenceBand].label} tone={BAND[best.confidenceBand].tone} />
            </View>
            <Text variant="small" style={{ color: colors.ink }}>
              {tileFacts(best)}
            </Text>
            {best.matchedFields.length > 0 && (
              <View style={styles.chips}>
                {best.matchedFields.map((field) => (
                  <Chip key={field} label={humanise(field)} />
                ))}
              </View>
            )}
            <View style={styles.more}>
              <Text variant="label" style={{ color: colors.brand }}>
                About this tile
              </Text>
              <Icon name="chevron-right" size={16} color={colors.brand} />
            </View>
          </View>
        </Pressable>
      )}

      <SearchNotes search={data} />

      {data.similar.length > 0 && (
        <View style={{ gap: space.sm }}>
          <View>
            <Text variant="heading">Similar glazes</Text>
            <Text variant="small">Other recipes, the closest photo of each</Text>
          </View>
          {/* The scroll bar shows, so it's clear there are more cards to the side. */}
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
            {data.similar.map((item) => (
              <ResultCard key={item.imageId} item={item} onPress={() => open(item)} onImageError={refreshImages} style={{ width: 156 }} />
            ))}
          </ScrollView>
        </View>
      )}

      <YourRecipe search={data} />

      {more.length > 0 &&
        (showAll ? (
          <View style={{ gap: space.sm }}>
            <View>
              {/* Counts what the grid holds: everything but the closest match shown above. */}
              <Text variant="heading">More results ({more.length})</Text>
              <Text variant="small">Best of {data.ranker.candidateCount} compared. The same recipe can appear more than once.</Text>
            </View>
            <View style={styles.grid}>
              {more.map((item) => (
                <ResultCard key={item.imageId} item={item} onPress={() => open(item)} onImageError={refreshImages} style={styles.gridItem} />
              ))}
            </View>
          </View>
        ) : (
          <Button label={`More results (${more.length})`} icon="grid" kind="secondary" onPress={() => setShowAll(true)} />
        ))}

      <Text variant="small">
        These are photos of real fired tiles. A close match shows what a similar glaze has done before; it isn’t a promise that your glaze will fire the same way.
      </Text>
    </ScrollView>
  );
}

function ResultCard({ item, onPress, onImageError, style }: { item: SearchResultItem; onPress: () => void; onImageError: () => void; style?: StyleProp<ViewStyle> }) {
  const band = BAND[item.confidenceBand];
  return (
    <Pressable
      accessibilityRole="button"
      // Everything the card shows, since a screen reader reads only this: the photo, the score and its band.
      accessibilityLabel={`#${item.rank}: ${tileAlt(item)}. ${percent(item.score)}, ${band.label.toLowerCase()}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.85 }]}
    >
      <View>
        <TileImage uri={item.thumbnailUrl} cacheKey={`${item.imageId}:thumb`} style={styles.image} onError={onImageError} />
        <View style={styles.rank}>
          <Text style={styles.rankText}>#{item.rank}</Text>
        </View>
        {item.resultType === 'synthetic_preview' && (
          <View style={styles.flag}>
            <Text style={styles.flagText}>Generated preview</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        {item.source.recipeCode && <Text style={styles.code}>{item.source.recipeCode}</Text>}
        {item.source.recipeName && (
          <Text variant="label" numberOfLines={2}>
            {item.source.recipeName}
          </Text>
        )}
        <Text style={styles.score}>{percent(item.score)}</Text>
        <Badge label={band.label} tone={band.tone} />
        <Text variant="small" style={{ color: colors.ink }}>
          {tileFacts(item)}
        </Text>
      </View>
    </Pressable>
  );
}

const GROUPS = [
  { title: 'Fluxes', oxides: FLUX_OXIDES },
  { title: 'Stabilisers', oxides: STABILISER_OXIDES },
  { title: 'Glass former', oxides: FORMER_OXIDES },
];

/** The chemistry the search used, and its colorants: metallic oxides, which are in the UMF, and stains, which aren't. */
function YourRecipe({ search }: { search: RecipeImageSearchResponse }) {
  const { umf, colourants, colorantMaterials, recipeCode, type } = search.query;
  if (!umf && !colourants) return null;

  const present = Object.keys(umf ?? {}).filter((oxide) => (umf?.[oxide] ?? 0) > 0);
  const listed = new Set([...GROUPS.flatMap((group) => group.oxides), ...COLORANT_OXIDES, ...OTHER_OXIDES]);
  const groups = [
    ...GROUPS.map((group) => ({ title: group.title, oxides: group.oxides.filter((oxide) => present.includes(oxide)) })),
    { title: 'Colorants (metallic oxides)', oxides: COLORANT_OXIDES.filter((oxide) => present.includes(oxide)) },
    // Anything outside the usual lists still shows.
    {
      title: 'Other oxides',
      oxides: [...OTHER_OXIDES.filter((oxide) => present.includes(oxide) && !COLORANT_OXIDES.includes(oxide)), ...present.filter((oxide) => !listed.has(oxide))],
    },
  ].filter((group) => group.oxides.length > 0);
  // A search made before the API listed every colorant only knows its stains.
  const colorants: ColorantMaterial[] | null =
    colorantMaterials ?? colourants?.map((c) => ({ materialId: c.materialId ?? '', name: c.name ?? c.materialId ?? 'unnamed', kind: 'stain', percentOfBase: c.percentOfBase })) ?? null;

  // A regular user gets no chemistry from the API (the match, not how it was worked out), so only the colorants show.
  const title = !umf
    ? 'Colorants in your recipe'
    : type === 'recipe'
      ? `Chemistry of ${recipeCode ?? 'the recipe'}`
      : type === 'umf'
        ? 'The UMF you searched'
        : 'Your recipe’s chemistry';

  return (
    <Card>
      <View>
        <Text variant="heading">{title}</Text>
        {umf && <Text variant="small">Unity formula: the fluxes add up to 1</Text>}
      </View>
      {groups.map((group) => (
        <View key={group.title} style={{ gap: 4 }}>
          <Text variant="label" style={{ color: colors.ink2 }}>
            {group.title}
          </Text>
          <View style={styles.chem}>
            {group.oxides.map((oxide) => (
              <Text key={oxide} style={{ fontSize: textSize.sm }}>
                <Text style={{ color: colors.ink2, fontSize: textSize.sm }}>{oxideLabel(oxide)} </Text>
                <Text style={styles.chemValue}>{formatUmf(umf![oxide]!)}</Text>
              </Text>
            ))}
          </View>
        </View>
      ))}
      {colorants &&
        (colorants.length === 0 ? (
          <Text style={{ fontSize: textSize.sm }}>
            <Text style={{ fontFamily: font.semibold, fontSize: textSize.sm }}>Colorants: </Text>
            none
          </Text>
        ) : (
          <View style={{ gap: 4 }}>
            <Text variant="label" style={{ color: colors.ink2 }}>
              Colorants
            </Text>
            {colorants.map((c) => (
              <View key={c.materialId || c.name} style={styles.colorant}>
                <Text style={{ fontSize: textSize.sm, flexShrink: 1 }}>{c.name}</Text>
                <Badge label={COLORANT_KIND[c.kind]?.label ?? c.kind} tone={COLORANT_KIND[c.kind]?.tone ?? 'neutral'} />
                <Text style={styles.chemValue}>{Number(c.percentOfBase.toFixed(2))}%</Text>
              </View>
            ))}
            <Text variant="small">Added on top of the base: parts per 100 parts of the rest of the recipe.</Text>
          </View>
        ))}
    </Card>
  );
}

const NO_ANALYSIS = 'no_oxide_analysis:';
const PARTIAL = ['chemistry_search_unavailable', 'text_search_unavailable'];
/** Notes the API adds that need nothing on screen. */
const SILENT = ['no_reliable_match', 'calculated_for_this_search', 'results_changed_since_search'];

/** The search's own notes: partial results, materials left out of the chemistry, data quality. */
function SearchNotes({ search }: { search: RecipeImageSearchResponse }) {
  const stains = new Set((search.query.colourants ?? []).map((c) => c.name));
  const partial = search.warnings.some((w) => PARTIAL.includes(w));
  const notStains = search.warnings
    .filter((w) => w.startsWith(NO_ANALYSIS))
    .map((w) => w.slice(NO_ANALYSIS.length))
    .filter((name) => !stains.has(name));
  const other = search.warnings
    .filter((w) => !w.startsWith(NO_ANALYSIS) && !PARTIAL.includes(w) && !SILENT.includes(w))
    .map(warningText)
    .filter((text): text is string => text !== null);
  if (!partial && notStains.length === 0 && other.length === 0) return null;
  const one = notStains.length === 1;

  return (
    <View style={{ gap: space.sm }}>
      {partial && <Notice tone="warn">Part of the search was unavailable, so these results may be incomplete. Try again shortly.</Notice>}
      {notStains.length > 0 && (
        <Notice tone="info">
          {`${notStains.join(', ')} ${one ? 'isn’t' : 'aren’t'} in our materials data, so ${one ? 'it isn’t' : 'they aren’t'} counted. If ${one ? 'it isn’t a stain' : 'they aren’t stains'}, pick another entry from the list.`}
        </Notice>
      )}
      {other.map((note) => (
        <Text key={note} variant="small">
          • {note}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // About 600 wide at most, so lines stay readable on a tablet.
  body: { padding: space.xl, gap: space.lg, paddingBottom: 40, width: '100%', maxWidth: 600, alignSelf: 'center' },
  searched: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.md },
  closest: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  closestImage: { width: '100%', aspectRatio: 1, backgroundColor: colors.sunken },
  closestBody: { padding: space.lg, gap: space.sm },
  // Neutral, not blue: blue is kept for links, and a code isn't one.
  codeLarge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.sunken, color: colors.ink, fontFamily: font.bold, fontSize: textSize.md, letterSpacing: 0.3 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scoreLarge: { fontFamily: font.extrabold, fontSize: textSize.display, lineHeight: 38, color: colors.ink, fontVariant: ['tabular-nums'] },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  gridItem: { width: '47%', flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1, backgroundColor: colors.sunken },
  rank: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
  rankText: { fontFamily: font.bold, fontSize: textSize.xs, color: colors.ink },
  flag: { position: 'absolute', left: 8, right: 8, bottom: 8, padding: 4, borderRadius: 6, backgroundColor: colors.warnSoft },
  flagText: { fontFamily: font.bold, fontSize: textSize.xs, color: colors.warn, textAlign: 'center' },
  cardBody: { padding: space.md, gap: 4, alignItems: 'flex-start' },
  code: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.sunken, color: colors.ink, fontFamily: font.bold, fontSize: textSize.xs },
  score: { fontFamily: font.extrabold, fontSize: textSize.lg, color: colors.ink, fontVariant: ['tabular-nums'] },
  chem: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 4 },
  chemValue: { fontFamily: font.semibold, fontSize: textSize.sm, color: colors.ink, fontVariant: ['tabular-nums'] },
  colorant: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
