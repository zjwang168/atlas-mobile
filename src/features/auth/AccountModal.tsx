/**
 * Account panel opened from the My Places avatar.
 *
 * States:
 * - Anonymous user (default silent identity): shows "Guest" + a form to
 *   upgrade to a permanent email account (keeps the same user id, so all
 *   existing data stays owned), or sign in to an existing account.
 * - Email user: shows the email + sign out.
 *
 * Placeholder styling — to be replaced by Qihang's design; logic layer stays.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  signInWithEmail,
  signOut,
  supabase,
  upgradeToEmailAccount,
} from '../../services/supabase/supabaseClient';

type Props = { visible: boolean; onClose: () => void };

export default function AccountModal({ visible, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [mode, setMode] = useState<'upgrade' | 'signIn'>('upgrade');

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setInfo(null);
    supabase.auth.getUser().then(({ data }: { data: { user: { email?: string | null; is_anonymous?: boolean } | null } }) => {
      const u = data.user;
      setUserEmail(u?.email ?? null);
      setIsAnonymous(Boolean(u?.is_anonymous) || !u?.email);
    });
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'upgrade') {
        await upgradeToEmailAccount(email.trim(), password);
        setInfo('Account created — your data is now tied to this email.');
        setUserEmail(email.trim());
        setIsAnonymous(false);
      } else {
        await signInWithEmail(email.trim(), password);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign out failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.title}>Account</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {!isAnonymous && userEmail ? (
            <>
              <Text style={styles.subtitle}>Signed in as</Text>
              <Text style={styles.emailText}>{userEmail}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleSignOut} disabled={busy}>
                {busy ? <ActivityIndicator /> : <Text style={styles.secondaryButtonText}>Sign Out</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>
                {mode === 'upgrade'
                  ? "You're browsing as a guest. Create an account to keep your places on any device."
                  : 'Sign in to an existing account.'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password (min 6 characters)"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {info ? <Text style={styles.info}>{info}</Text> : null}
              <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === 'upgrade' ? 'Create Account' : 'Sign In'}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  setMode(mode === 'upgrade' ? 'signIn' : 'upgrade');
                }}
              >
                <Text style={styles.switchText}>
                  {mode === 'upgrade'
                    ? 'Already have an account? Sign in'
                    : 'New here? Create an account'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  closeText: { fontSize: 18, color: '#6B7280' },
  subtitle: { fontSize: 14, color: '#6B7280' },
  emailText: { fontSize: 16, fontWeight: '600', color: '#111827' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  error: { color: '#DC2626', fontSize: 13 },
  info: { color: '#16A34A', fontSize: 13 },
  button: {
    backgroundColor: '#16A34A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: { color: '#DC2626', fontSize: 15, fontWeight: '600' },
  switchText: { color: '#16A34A', fontSize: 13, textAlign: 'center', marginTop: 4 },
});
