import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
    }
    setLoading(false);
  }, [email, password]);

  const signUp = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message);
    }
    setLoading(false);
  }, [email, password]);

  const signOut = useCallback(async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      {session ? (
        <>
          <Text style={styles.label}>Signed in as {session.user.email}</Text>
          <Pressable style={styles.button} onPress={signOut} disabled={loading}>
            {loading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign out</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={signIn} disabled={loading}>
            {loading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={signUp} disabled={loading}>
            <Text style={styles.buttonSecondaryText}>Create account</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    opacity: 0.8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2f95dc',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonSecondary: {
    padding: 12,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: '#2f95dc',
  },
  error: {
    color: '#c00',
    fontSize: 14,
  },
});
