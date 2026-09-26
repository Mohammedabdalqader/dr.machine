import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading, disabled, style, ...rest }: Props) {
  const theme = useTheme();
  const background =
    variant === 'primary' ? theme.primary : variant === 'secondary' ? theme.surfaceMuted : 'transparent';
  const color = variant === 'primary' ? 'onPrimary' : 'text';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.base,
        { backgroundColor: background, opacity: disabled ? 0.5 : state.pressed ? 0.8 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={theme[color]} />
      ) : (
        <AppText variant="heading" color={color} style={styles.label}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});
