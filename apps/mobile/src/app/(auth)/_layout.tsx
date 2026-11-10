import { Stack } from 'expo-router/stack';
import { colors } from '../../theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
