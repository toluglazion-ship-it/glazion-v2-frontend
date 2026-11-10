import { useState } from 'react';
import { StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, font, radius, textSize } from '../theme';
import { Image } from 'expo-image';
import { SvgXml } from 'react-native-svg';

const SVG_DATA = 'data:image/svg+xml,';
/** A photo with a shorter long edge than this is low resolution (the imported library is mostly 113 px). */
const LOW_RES = 400;
/** Shown at most this many times its own size: past that, enlarging only adds blur. */
const MAX_ZOOM = 2;

interface Props {
  uri: string | null;
  /**
   * The image's id. Its link is signed and changes on every response, so the photo is cached
   * under this instead of under the link.
   */
  cacheKey?: string;
  style?: StyleProp<ImageStyle>;
  /** Links expire after 10 minutes; a failed load asks for fresh ones. */
  onError?: () => void;
  /** What the photo shows, for screen readers. Left out where a surrounding button already says it. */
  label?: string;
  /** Large views say when a photo is low resolution; small cards don't need to. */
  flagLowRes?: boolean;
}

/**
 * A tile photo. Real results are ordinary image URLs. The sample data uses inline SVG swatches,
 * which an image view can't decode, so those are drawn with react-native-svg instead.
 */
export default function TileImage({ uri, cacheKey, style, onError, label, flagLowRes }: Props) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const described = label ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const) : {};
  // A result can come without a photo; keep its space so the layout doesn't jump, and say so.
  if (!uri) {
    return (
      <View {...described} style={[style, { backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
        <Feather name="image" size={24} color={colors.ink3} />
        <Text style={{ fontFamily: font.medium, fontSize: textSize.xs, color: colors.ink3 }}>No photo yet</Text>
      </View>
    );
  }
  if (uri.startsWith(SVG_DATA)) {
    return (
      <View {...described} style={[style, { overflow: 'hidden' }]}>
        <SvgXml xml={decodeURIComponent(uri.slice(SVG_DATA.length))} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
      </View>
    );
  }
  // Fills its box, unless that would blow a small photo up past twice its size: then it sits centred, and large
  // views say why it isn't bigger.
  const small = !!natural && Math.max(natural.width, natural.height) < LOW_RES;
  return (
    <View {...described} style={[style, styles.frame]}>
      <Image
        source={{ uri, cacheKey }}
        style={[styles.fill, small && { maxWidth: natural.width * MAX_ZOOM, maxHeight: natural.height * MAX_ZOOM }]}
        contentFit="cover"
        transition={150}
        onLoad={(e) => setNatural({ width: e.source.width, height: e.source.height })}
        onError={onError}
      />
      {flagLowRes && small && <Text style={styles.note}>Low-resolution photo</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  note: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
    fontFamily: font.semibold,
    fontSize: textSize.xs,
    color: colors.ink2,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
});
