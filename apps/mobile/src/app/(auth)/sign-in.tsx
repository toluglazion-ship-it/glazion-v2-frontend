import { useState } from 'react';
import { View } from 'react-native';
import Link from 'expo-router/link';
import { errorMessage, signIn } from '@glazion/api-client';
import AuthScreen from '../../components/AuthScreen';
import { Button, Field, Input, Notice, Text } from '../../components/ui';
import { colors, font, textSize } from '../../theme';

const linkStyle = { fontFamily: font.semibold, fontSize: textSize.sm, color: colors.brand };

export default function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (loading) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // The root layout swaps to the signed-in screens as soon as the tokens land in the store.
      await signIn(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err, 'That username or password isn’t right.'));
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="Sign in to Glazion"
      subtitle="Match your glaze recipes to real fired tiles."
      footer={
        <Text variant="muted" style={{ color: colors.ink2 }}>
          Not a member?{' '}
          <Link href="/register" style={linkStyle}>
            Register
          </Link>
        </Text>
      }
    >
      {error !== '' && <Notice>{error}</Notice>}

      <Field label="Username">
        <Input value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" returnKeyType="next" />
      </Field>

      <Field label="Password">
        <Input value={password} onChangeText={setPassword} secure autoComplete="current-password" returnKeyType="go" onSubmitEditing={handleSubmit} />
      </Field>

      <View style={{ alignItems: 'flex-end', marginTop: -4 }}>
        <Link href="/forgot-password" style={linkStyle}>
          Forgot password?
        </Link>
      </View>

      <Button label="Sign in" onPress={handleSubmit} loading={loading} loadingLabel="Signing in…" />
    </AuthScreen>
  );
}
