import { useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { findResult, searchApi } from '@glazion/api-client/main';
import type { ScoreBreakdown, SearchFeedbackValue } from '@glazion/types';
import TileImage from '../../../../components/TileImage';
import { Badge, Button, Card, Chip, Empty, Notice, Row, Text, TileSkeleton } from '../../../../components/ui';
import { handoff } from '../../../../lib/handoff';
import { usePush } from '../../../../lib/usePush';
import { BAND, clayBodyLabel, firingLabel, humanise, percent, tileAlt, tileQuestion } from '../../../../lib/labels';
import { searchFailure, useRunSearch } from '../../../../lib/searchRun';
import { colors, font, radius, space, textSize } from '../../../../theme';

/** Image is left out while it's empty (the ranker doesn't compare photos yet). */
const BREAKDOWN: { key: keyof ScoreBreakdown; label: string; always?: boolean }[] = [
  { key: 'chemistrySimilarity', label: 'Chemistry', always: true },
  { key: 'firingCompatibility', label: 'Firing', always: true },
  { key: 'colourantSimilarity', label: 'Colorants' },
  { key: 'labelOrTextSimilarity', label: 'Surface and colour', always: true },
  { key: 'imageSimilarity', label: 'Image' },
];

/** Fresh image links at most this often, so an image that can't load doesn't ask again and again. */
const REFRESH_GAP = 30_000;

export default function ResultDetail() {
  const { searchId, imageId } = useLocalSearchParams<{ searchId: string; imageId: string }>();
  const router = useRouter();
  const push = usePush();
  const lastRefresh = useRef(0);

  const search = useQuery({ queryKey: ['search', searchId], queryFn: () => searchApi.getOne(searchId), staleTime: 5 * 60_000 });
  // A similar glaze isn't always in items, so both lists are looked in.
  const item = findResult(search.data, imageId);
  const findLike = useRunSearch();

  const feedback = useMutation({
    mutationFn: (value: SearchFeedbackValue) => searchApi.sendFeedback({ searchId, imageId, feedback: value }),
  });

  const { refetch } = search;
  const refreshImage = useCallback(() => {
    if (Date.now() - lastRefresh.current < REFRESH_GAP) return;
    lastRefresh.current = Date.now();
    void refetch();
  }, [refetch]);

  if (search.isPending) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <TileSkeleton label="Loading the result" />
      </ScrollView>
    );
  }
  if (!item) {
    return (
      <Empty
        icon="alert-circle"
        title="This result isn’t available"
        text={search.isError ? errorMessage(search.error) : 'It isn’t in this search any more. Run the search again to see it.'}
        action={
          <View style={styles.actions}>
            {search.isError && <Button label="Try again" icon="refresh-cw" onPress={() => search.refetch()} />}
            <Button label="Back to Find tiles" kind="secondary" onPress={() => router.navigate('/')} />
          </View>
        }
      />
    );
  }

  const band = BAND[item.confidenceBand];
  const failure = findLike.isError ? searchFailure(findLike.error) : null;

  function askAboutTile() {
    if (!item) return;
    handoff.askInChat(tileQuestion(searchId, item));
    push('/conversation/new');
  }

  function findTilesLikeThis() {
    if (!item?.source.recipeId) return;
    findLike.mutate({
      request: {
        query: { type: 'recipe', recipeId: item.source.recipeId },
        firing: { coneMin: item.firing.coneMin, coneMax: item.firing.coneMax, atmosphere: item.firing.atmosphere },
        topK: 12,
        includeRecipeMetadata: true,
      },
      label: `Tiles like ${item.source.recipeCode ?? item.source.recipeName ?? 'a result'}`,
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View>
        <TileImage uri={item.displayUrl} cacheKey={item.imageId} style={styles.image} onError={refreshImage} label={tileAlt(item)} flagLowRes />
        {item.resultType === 'synthetic_preview' && (
          <View style={styles.flag}>
            <Text style={styles.flagText}>Generated preview, not a real tile</Text>
          </View>
        )}
      </View>

      <View style={{ gap: space.sm }}>
        {item.source.recipeCode && <Text style={styles.code}>{item.source.recipeCode}</Text>}
        {/* The recipe's name, under its code or on its own when it has none. */}
        {item.source.recipeName && <Text variant="heading">{item.source.recipeName}</Text>}
        <View style={styles.scoreHead}>
          <Text style={styles.score}>{percent(item.score)}</Text>
          <Badge label={band.label} tone={band.tone} />
        </View>
      </View>

      {/* The next step comes first, not under everything else: more tiles like this one, or a question about it. */}
      <View style={{ gap: space.sm }}>
        {item.source.recipeId && <Button label="Find tiles like this recipe" icon="search" onPress={findTilesLikeThis} loading={findLike.isPending} loadingLabel="Finding tiles…" />}
        {failure && <Notice>{failure.message}</Notice>}
        <Button label="Ask Glazion about this tile" icon="message-circle" kind="secondary" onPress={askAboutTile} />
      </View>

      {/* The breakdown is for admins only: for a regular user the API sends none, so the match shows without its why. */}
      {BREAKDOWN.some(({ key }) => item.scoreBreakdown[key] != null) && (
        <Card>
          {BREAKDOWN.filter(({ key, always }) => always || item.scoreBreakdown[key] != null).map(({ key, label }) => {
            const value = item.scoreBreakdown[key] ?? null;
            return (
              <View key={key} style={styles.bar}>
                <Text variant="small" style={{ width: 92 }}>
                  {label}
                </Text>
                <View style={styles.track}>{value !== null && <View style={[styles.fill, { width: `${Math.round(value * 100)}%` }]} />}</View>
                <Text variant="label" style={styles.barValue}>
                  {value === null ? 'Not compared' : percent(value)}
                </Text>
              </View>
            );
          })}
          {/* What each line compares, in a sentence, since the labels alone don't say. */}
          <Text variant="small">
            How close this tile is on each: the glaze’s chemistry (its UMF), the firing (cone and atmosphere), and the surface and colour recorded for the
            tile.
          </Text>
        </Card>
      )}

      {item.matchedFields.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text variant="label" style={{ color: colors.ink2 }}>
            Matched on
          </Text>
          <View style={styles.chips}>
            {item.matchedFields.map((field) => (
              <Chip key={field} label={humanise(field)} />
            ))}
          </View>
        </View>
      )}

      <Card>
        <Row label="Clay body" value={clayBodyLabel(item.tile.clayBody) ?? '—'} />
        <Row label="Firing" value={firingLabel(item.firing)} />
        <Row label="Body colour" value={humanise(item.tile.variant)} />
        <Row label="Surface" value={humanise(item.tile.surface)} />
        <Row label="Opacity" value={humanise(item.tile.opacity)} />
      </Card>

      {item.limitations.length > 0 && (
        <Card style={{ backgroundColor: colors.canvas }}>
          <Text variant="label" style={{ color: colors.ink2 }}>
            Keep in mind
          </Text>
          {item.limitations.map((limitation) => (
            <Text key={limitation} style={{ fontSize: textSize.sm }}>
              • {limitation}
            </Text>
          ))}
        </Card>
      )}

      <Card>
        {/* Thanks straight away; the buttons come back with the reason if it didn't go through. */}
        {feedback.isPending || feedback.isSuccess ? (
          <Text variant="muted">Thanks, that’s recorded.</Text>
        ) : (
          <>
            <Text variant="label">Is this a useful match?</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Useful" icon="thumbs-up" kind="secondary" small onPress={() => feedback.mutate('relevant')} style={{ flex: 1 }} />
              <Button label="Not useful" icon="thumbs-down" kind="secondary" small onPress={() => feedback.mutate('not_relevant')} style={{ flex: 1 }} />
            </View>
          </>
        )}
        {feedback.isError && <Notice>{`Not sent. ${errorMessage(feedback.error)}`}</Notice>}
      </Card>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, gap: space.lg, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.sunken },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.md },
  flag: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 6, borderRadius: 8, backgroundColor: colors.warnSoft },
  flagText: { fontFamily: font.bold, fontSize: textSize.sm, color: colors.warn, textAlign: 'center' },
  code: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.sunken, color: colors.ink, fontFamily: font.bold, fontSize: textSize.md, letterSpacing: 0.3 },
  scoreHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  score: { fontFamily: font.extrabold, fontSize: textSize.display, lineHeight: 38, color: colors.ink, fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.brand },
  // Wide enough for "Not compared", so every bar starts and ends in the same place.
  barValue: { width: 104, textAlign: 'right', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
