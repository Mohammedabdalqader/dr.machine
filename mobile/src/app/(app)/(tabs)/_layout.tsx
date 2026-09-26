import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { MANAGER_ROLES, REVIEWER_ROLES } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { hasRole } = useAuth();
  const reviewer = hasRole(REVIEWER_ROLES);
  const manager = hasRole(MANAGER_ROLES);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: 64, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="machines" options={{ title: t('tabs.machines'), tabBarIcon: icon('construct-outline') }} />
      <Tabs.Screen name="knowledge" options={{ title: t('tabs.knowledge'), tabBarIcon: icon('library-outline') }} />
      <Tabs.Screen
        name="imports"
        options={{ title: t('tabs.imports'), tabBarIcon: icon('cloud-upload-outline'), href: reviewer ? undefined : null }}
      />
      <Tabs.Screen
        name="team"
        options={{ title: t('tabs.team'), tabBarIcon: icon('people-outline'), href: manager ? undefined : null }}
      />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
