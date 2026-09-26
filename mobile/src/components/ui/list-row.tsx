import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/providers/language-provider';

// Line clamping on web (-webkit-line-clamp) sometimes paints rows blank in Chromium; clamp on native only.
const clamp = (lines: number) => (Platform.OS === 'web' ? undefined : lines);

type Props = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  footer?: ReactNode;
  onPress?: () => void;
};

export function ListRow({ title, subtitle, right, footer, onPress }: Props) {
  const theme = useTheme();
  const { rtl } = useLanguage();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={styles.body}>
        <AppText variant="heading" numberOfLines={clamp(2)}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={clamp(3)}>
            {subtitle}
          </AppText>
        ) : null}
        {footer}
      </View>
      {right}
      {onPress ? (
        <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TouchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 2 },
});
