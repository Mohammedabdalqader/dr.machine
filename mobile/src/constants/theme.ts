/**
 * Mu'allim brand: dark navy + signal orange, taken from the product brief.
 * Touch targets are large on purpose: technicians often wear gloves.
 */
const brand = {
  navy: '#1E2632',
  navyDeep: '#141A23',
  orange: '#E0851F',
  orangeSoft: '#FBEEDD',
  steel: '#2F5F85',
  success: '#2E8B57',
  warning: '#D9822B',
  danger: '#C0392B',
};

export const Colors = {
  light: {
    ...brand,
    text: '#1E2632',
    textSecondary: '#5B6573',
    background: '#F5F7FA',
    surface: '#FFFFFF',
    surfaceMuted: '#ECF0F4',
    border: '#D8DEE6',
    primary: brand.orange,
    onPrimary: '#FFFFFF',
    safetyBackground: brand.orangeSoft,
    safetyText: '#8A4B0F',
  },
  dark: {
    ...brand,
    text: '#F2F4F7',
    textSecondary: '#A6B0BD',
    background: '#141A23',
    surface: '#1E2632',
    surfaceMuted: '#27313F',
    border: '#344152',
    primary: brand.orange,
    onPrimary: '#FFFFFF',
    safetyBackground: '#3A2A17',
    safetyText: '#F6C98E',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/** Minimum touch target for gloved hands (Apple HIG is 44; we go bigger). */
export const TouchTarget = 56;

export const MaxContentWidth = 720;
