import { cloneElement, useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, font, radius, space, tones, textSize, type Tone } from '../theme';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

type Variant = 'body' | 'small' | 'label' | 'muted' | 'title' | 'heading' | 'strong';

const TEXT: Record<Variant, object> = {
  // 16px reading text and nothing secondary under 14px, so phones don't need zooming in.
  body: { fontFamily: font.regular, fontSize: textSize.md, lineHeight: 24, color: colors.ink },
  small: { fontFamily: font.regular, fontSize: textSize.sm, lineHeight: 20, color: colors.ink2 },
  muted: { fontFamily: font.regular, fontSize: textSize.sm, lineHeight: 20, color: colors.ink3 },
  label: { fontFamily: font.semibold, fontSize: textSize.sm, lineHeight: 20, color: colors.ink },
  strong: { fontFamily: font.semibold, fontSize: textSize.md, lineHeight: 24, color: colors.ink },
  heading: { fontFamily: font.bold, fontSize: textSize.lg, lineHeight: 24, color: colors.ink },
  title: { fontFamily: font.extrabold, fontSize: textSize.xl, lineHeight: 32, letterSpacing: -0.5, color: colors.ink },
};

export function Text({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  // Titles and headings are headers for screen readers too, so heading navigation finds them.
  const role = variant === 'title' || variant === 'heading' ? 'header' : undefined;
  return <RNText accessibilityRole={role} {...rest} style={[TEXT[variant], style]} />;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  loading?: boolean;
  /** Said next to the spinner while loading, e.g. "Signing in…". */
  loadingLabel?: string;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, kind = 'primary', icon, loading, loadingLabel, disabled, small, style }: ButtonProps) {
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? colors.bad : kind === 'ghost' ? colors.ink2 : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        kind === 'primary' && { backgroundColor: colors.ink },
        kind === 'secondary' && { backgroundColor: colors.surface, borderColor: colors.lineStrong },
        // Outlined too, lightly, so a plain text button still reads as one.
        kind === 'ghost' && { borderColor: colors.line },
        kind === 'danger' && { backgroundColor: colors.surface, borderColor: '#e8bab6' },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      {/* The words stay while it works, so it never turns into a bare spinner with no name. */}
      <RNText style={[styles.buttonLabel, small && { fontSize: textSize.sm }, { color: fg }]}>{loading ? (loadingLabel ?? label) : label}</RNText>
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, color = colors.ink2, disabled }: { name: IconName; onPress: () => void; label: string; color?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.sunken }, disabled && { opacity: 0.35 }]}
    >
      <Icon name={name} size={20} color={color} />
    </Pressable>
  );
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children: ReactElement<{ accessibilityLabel?: string }> }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text variant="label">{label}</Text>}
      {/* The visible label isn't tied to the input on native, so name the input for screen readers. */}
      {label && !children.props.accessibilityLabel ? cloneElement(children, { accessibilityLabel: label }) : children}
      {hint && <Text variant="small">{hint}</Text>}
    </View>
  );
}

/** The bar above an iPhone's number keypad, which has no key of its own to close it. */
const DONE_BAR = 'glazion-keyboard-done';
const NUMERIC = new Set(['decimal-pad', 'number-pad', 'numeric']);

/** Rendered once per screen; number fields on iOS show it above the keypad. */
export function KeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={DONE_BAR}>
      <View style={styles.doneBar}>
        <Pressable accessibilityRole="button" onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.doneButton}>
          <RNText style={styles.doneLabel}>Done</RNText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** `inputRef` hands over the TextInput, e.g. to focus it. (Not `ref`: checked from the repo root, React's types come from another copy and won't match.) */
export function Input({ style, secure, invalid, inputRef, ...rest }: TextInputProps & { secure?: boolean; invalid?: boolean; inputRef?: (input: TextInput | null) => void }) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const numeric = NUMERIC.has(rest.keyboardType ?? '');

  const input = (
    <TextInput
      placeholderTextColor={colors.ink3}
      // Number keypads get a way to close them: Done above the keypad on iOS, the done key on Android.
      inputAccessoryViewID={numeric && Platform.OS === 'ios' ? DONE_BAR : undefined}
      returnKeyType={numeric ? 'done' : undefined}
      {...rest}
      ref={inputRef}
      secureTextEntry={secure && hidden}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      style={[styles.input, invalid && { borderColor: colors.bad }, focused && styles.inputFocused, secure && { paddingRight: 48 }, style]}
    />
  );

  if (!secure) return input;
  return (
    <View>
      {input}
      <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} onPress={() => setHidden((h) => !h)} style={styles.inputAffix} hitSlop={8}>
        <Icon name={hidden ? 'eye' : 'eye-off'} size={18} color={colors.ink3} />
      </Pressable>
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { bg, fg } = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: fg }]} />
      <RNText style={[styles.badgeLabel, { color: fg }]}>{label}</RNText>
    </View>
  );
}

export function Notice({ tone = 'bad', children, icon }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode; icon?: IconName }) {
  const { bg, fg } = tones[tone];
  // VoiceOver doesn't read out a view just because it has the alert role, so a problem is announced as it appears.
  useEffect(() => {
    if (tone === 'bad' && typeof children === 'string' && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(children);
  }, [tone, children]);
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : tone === 'ok' ? 'check-circle' : 'alert-circle')} size={18} color={fg} />
      <RNText style={[styles.noticeText, { color: fg }]}>{children}</RNText>
    </View>
  );
}

/** Shown wherever a screen is running on placeholder data. */
export function PreviewNote({ children }: { children: string }) {
  return (
    <Notice tone="info">
      <RNText style={{ fontFamily: font.bold }}>Preview. </RNText>
      {children}
    </Notice>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      // A pressed chip darkens a little, so a tap shows it landed.
      style={({ pressed }) => [
        styles.chip,
        onPress && styles.chipTappable,
        selected && { backgroundColor: colors.ink, borderColor: colors.ink },
        !onPress && styles.chipStatic,
        pressed && !selected && { backgroundColor: colors.sunken },
        pressed && selected && { opacity: 0.85 },
      ]}
    >
      <RNText style={[styles.chipLabel, selected && { color: '#fff' }, !onPress && styles.chipStaticLabel]}>{label}</RNText>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && !active && { backgroundColor: colors.lineStrong }]}
          >
            <RNText style={[styles.segmentLabel, active && { color: '#fff' }]}>{option.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Loading() {
  return (
    <View style={styles.center} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.ink3} size="large" />
    </View>
  );
}

/** A grey bar standing in for text that's on its way, so the screen doesn't jump when it arrives. */
export function SkeletonLine({ width, height = 12 }: { width: `${number}%` | number; height?: number }) {
  return <View style={{ width, height, borderRadius: height / 2, backgroundColor: colors.sunken }} />;
}

/** The outline of a tile result card while it loads: photo, then a few lines. */
export function TileSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.skeletonCard} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <View style={{ width: '100%', aspectRatio: 1, backgroundColor: colors.sunken }} />
      <View style={{ padding: space.lg, gap: 10 }}>
        <SkeletonLine width="30%" />
        <SkeletonLine width="45%" height={22} />
        <SkeletonLine width="38%" height={28} />
        <SkeletonLine width="70%" />
      </View>
    </View>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={22} color={colors.ink3} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
        {text}
      </Text>
      {action}
    </View>
  );
}

/** A label on the left and a value on the right, used for facts and chemistry tables. */
export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.row}>
      {typeof label === 'string' ? <Text variant={strong ? 'strong' : 'body'} style={{ fontSize: textSize.sm, color: strong ? colors.ink : colors.ink2 }}>{label}</Text> : label}
      {typeof value === 'string' ? <RNText style={styles.rowValue}>{value}</RNText> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.md, borderRadius: 10 },
  buttonLabel: { fontFamily: font.semibold, fontSize: textSize.md },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.fieldLine,
    borderRadius: radius.md,
    fontFamily: font.regular,
    fontSize: textSize.md,
    color: colors.ink,
  },
  // outlineWidth only matters in the browser preview, where the default focus ring doubles the border.
  inputFocused: { borderColor: colors.brand, outlineWidth: 0 },
  doneBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colors.sunken, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineStrong },
  doneButton: { minHeight: 36, paddingHorizontal: space.sm, justifyContent: 'center' },
  doneLabel: { fontFamily: font.semibold, fontSize: textSize.md, color: colors.brand },
  inputAffix: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 48, alignItems: 'center', justifyContent: 'center' },
  // Minimum heights rather than fixed ones, so larger text sizes grow the control instead of clipping it.
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24, paddingHorizontal: 9, paddingVertical: 2, borderRadius: radius.pill },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeLabel: { fontFamily: font.semibold, fontSize: textSize.xs },
  notice: { flexDirection: 'row', gap: 10, padding: space.md, borderRadius: radius.md },
  noticeText: { flex: 1, fontFamily: font.regular, fontSize: textSize.sm, lineHeight: 20 },
  chip: { minHeight: 34, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  // Chips you can tap get a full fingertip's height; ones that only show a value stay compact.
  chipTappable: { minHeight: 44 },
  chipLabel: { fontFamily: font.medium, fontSize: textSize.sm, color: colors.ink2 },
  // A label, not a toggle: squarer and borderless, so it doesn't invite a tap.
  chipStatic: { minHeight: 28, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, borderColor: 'transparent', backgroundColor: colors.sunken },
  chipStaticLabel: { fontSize: textSize.xs, color: colors.ink2 },
  segmented: { flexDirection: 'row', padding: 3, gap: 2, borderRadius: radius.md, backgroundColor: colors.sunken },
  segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs, paddingVertical: 6 },
  // Filled dark: white on the light grey track was 1.14:1, too close to see which one is chosen.
  segmentActive: { backgroundColor: colors.ink, boxShadow: '0 1px 2px rgba(14, 19, 32, 0.08)' },
  segmentLabel: { fontFamily: font.semibold, fontSize: textSize.sm, color: colors.ink2, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  skeletonCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: space.xl },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 30 },
  rowValue: { fontFamily: font.semibold, fontSize: textSize.sm, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 },
});
