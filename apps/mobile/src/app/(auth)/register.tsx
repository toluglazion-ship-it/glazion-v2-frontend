import { useState } from 'react';
import Link from 'expo-router/link';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { accountApi, usesSampleData } from '@glazion/api-client/main';
import { AccountStatus } from '@glazion/types';
import AuthScreen from '../../components/AuthScreen';
import { Button, Field, Input, Notice, PreviewNote, Text } from '../../components/ui';
import { colors, font, textSize } from '../../theme';

const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const linkStyle = { fontFamily: font.semibold, fontSize: textSize.sm, color: colors.brand };

export default function Register() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');

  const register = useMutation({ mutationFn: accountApi.register });

  function handleSubmit() {
    if (register.isPending) return;
    if (!displayName.trim() || !username.trim()) return setProblem('Enter your name and a username.');
    if (!EMAIL.test(email.trim())) return setProblem('Enter a valid email address.');
    if (password.length < MIN_PASSWORD) return setProblem(`Use at least ${MIN_PASSWORD} characters for your password.`);
    setProblem('');
    register.mutate({ displayName: displayName.trim(), username: username.trim(), email: email.trim(), password });
  }

  if (register.isSuccess) {
    return (
      <AuthScreen
        title={`Thanks, ${displayName.trim().split(' ')[0]}`}
        subtitle={
          register.data?.accountStatus === AccountStatus.Active
            ? 'Your account is ready. Sign in to start searching the tile library.'
            : 'Your account is waiting for approval. Once it’s approved you can sign in and start searching.'
        }
      >
        {usesSampleData('signUp') && <PreviewNote>Sign-up isn’t connected yet, so no account was created.</PreviewNote>}
        <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </AuthScreen>
    );
  }

  const error = problem || (register.isError ? errorMessage(register.error) : '');

  return (
    <AuthScreen
      title="Create your account"
      subtitle="Search the tile library and ask questions about your glazes."
      footer={
        <Text variant="muted" style={{ color: colors.ink2 }}>
          Already a member?{' '}
          <Link href="/sign-in" style={linkStyle}>
            Sign in
          </Link>
        </Text>
      }
    >
      {usesSampleData('signUp') && <PreviewNote>Sign-up isn’t connected yet. You can try the form, but it won’t create an account.</PreviewNote>}
      {error !== '' && <Notice>{error}</Notice>}

      <Field label="Full name">
        <Input value={displayName} onChangeText={setDisplayName} autoComplete="name" autoCapitalize="words" />
      </Field>
      <Field label="Username">
        <Input value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" />
      </Field>
      <Field label="Email">
        <Input value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
      </Field>
      <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
        <Input value={password} onChangeText={setPassword} secure autoComplete="new-password" />
      </Field>

      <Button label="Create account" onPress={handleSubmit} loading={register.isPending} loadingLabel="Creating your account…" />
    </AuthScreen>
  );
}
