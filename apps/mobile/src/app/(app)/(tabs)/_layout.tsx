import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../../components/ui';
import { colors, font, textSize } from '../../../theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Find tiles', icon: 'search' },
  // Its own icon: "sliders" is the search filters' (Narrow the results).
  { name: 'umf', title: 'Calculator', icon: 'percent' },
  { name: 'chat', title: 'Ask', icon: 'message-circle' },
  { name: 'account', title: 'Account', icon: 'user' },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.ink3,
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: textSize.xs, lineHeight: 18 },
        // The default 49px clipped the labels under the icons; this leaves room for larger text too.
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 62 + insets.bottom, paddingTop: 6 },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarIcon: ({ color }) => <Icon name={tab.icon} size={22} color={color as string} /> }} />
      ))}
    </Tabs>
  );
}
