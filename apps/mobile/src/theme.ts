// The same palette and type as the web apps (packages/ui/src/styles.css).

export const colors = {
  ink: '#0e1320',
  ink2: '#4b5264',
  ink3: '#656a79',
  line: '#e5e6ea',
  lineStrong: '#cfd2d9',
  /** Field outlines: at least 3:1 against white and the page, so the box itself can be seen. */
  fieldLine: '#858a96',
  surface: '#ffffff',
  canvas: '#f7f6f3',
  sunken: '#f1f0ec',
  brand: '#0264d8',
  brandSoft: '#e6f0fc',
  ok: '#17734a',
  okSoft: '#e4f3ea',
  warn: '#8f5600',
  warnSoft: '#fcefd6',
  bad: '#b3261e',
  badSoft: '#fcebe9',
};

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

/** The type scale: every text size in the app is one of these. 16 is reading text; nothing secondary goes under 14 but tab and badge labels. */
export const textSize = { xs: 13, sm: 14, md: 16, lg: 18, xl: 26, display: 34 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

export const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.sunken, fg: colors.ink2 },
  ok: { bg: colors.okSoft, fg: colors.ok },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.badSoft, fg: colors.bad },
  info: { bg: colors.brandSoft, fg: colors.brand },
};
