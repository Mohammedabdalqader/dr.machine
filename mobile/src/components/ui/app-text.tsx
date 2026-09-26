import { StyleSheet, Text, type TextProps } from 'react-native';

import type { ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/providers/language-provider';

export type AppTextProps = TextProps & {
  variant?: 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
  color?: keyof ThemeColors;
};

/**
 * Text aligned to the reading direction of the current language. The writing
 * direction is left to the text itself, so English content inside the Arabic
 * interface (and the reverse) keeps its punctuation in the right place.
 */
export function AppText({ variant = 'body', color = 'text', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const { rtl } = useLanguage();
  return (
    <Text
      style={[
        styles[variant],
        { color: theme[color], textAlign: rtl ? 'right' : 'left' },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  display: { fontSize: 40, lineHeight: 48, fontWeight: '800' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 19, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18 },
});
