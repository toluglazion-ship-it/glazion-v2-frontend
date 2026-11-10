import { useState } from 'react';
import Link from 'expo-router/link';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { accountApi, usesSampleData } from '@glazion/api-client/main';
import AuthScreen from '../../components/AuthScreen';
import { Button, Field, Input, Notice } from '../../components/ui';
import { colors, font, textSize } from '../../theme';

export default function ForgotPassword() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const reset = useMutation({ mutationFn: accountApi.requestPasswordReset });

  // Until the API sends reset emails the form could only pretend to, so it points people to an admin instead.
  if (usesSampleData('passwordReset')) {
    return (
      <AuthScreen title="Reset your password" subtitle="Password reset by email isn’t available yet. Ask a Glazion admin to set a new password for you, then sign in with it.">
        <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </AuthScreen>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthScreen title="Check your email" subtitle={`If there’s an account for ${identifier.trim()}, we’ve sent a link to set a new password.`}>
        <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your username or email and we’ll send you a link to set a new one."
      footer={
        <Link href="/sign-in" style={{ fontFamily: font.semibold, fontSize: textSize.sm, color: colors.brand }}>
          Back to sign in
        </Link>
      }
    >
      {reset.isError && <Notice>{errorMessage(reset.error)}</Notice>}
      <Field label="Username or email">
        <Input value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => identifier.trim() && reset.mutate(identifier.trim())} />
      </Field>
      <Button label="Send reset link" onPress={() => reset.mutate(identifier.trim())} loading={reset.isPending} loadingLabel="Sending…" disabled={!identifier.trim()} />
    </AuthScreen>
  );
}
