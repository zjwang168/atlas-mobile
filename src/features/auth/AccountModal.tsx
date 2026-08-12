/**
 * Account panel opened from the My Places avatar.
 *
 * Flows:
 * - Simple registration: email/password sign-up and sign-in, preserving the
 *   current demo-friendly "enter an email + password" experience.
 * - Gmail verification: email OTP -> verify code -> set password -> signed in.
 * - Forgot password:
 *   - Simple flow: send a reset email for the email/password account.
 *   - Gmail flow: resend OTP, verify, then set a new password.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
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
import type { Session } from '@supabase/supabase-js';

import {
  sendEmailOtp,
  sendPasswordResetEmail,
  setCurrentUserPassword,
  signUpWithEmail,
  signInWithEmail,
  signOut,
  supabase,
  verifyEmailOtp,
  verifyRecoveryOtp,
} from '../../services/supabase/supabaseClient';

type Props = { visible: boolean; onClose: () => void };

type RootView = 'login' | 'signupChooser' | 'simple' | 'gmail' | 'recovery';
type SimpleMode = 'signUp' | 'signIn';
type GmailStep = 'email' | 'code' | 'password';
type RecoveryMode = 'chooser' | 'simple' | 'gmail';
type GmailRecoveryStep = 'email' | 'code' | 'password';

export default function AccountModal({ visible, onClose }: Props) {
  const [rootView, setRootView] = useState<RootView>('login');
  const [simpleMode, setSimpleMode] = useState<SimpleMode>('signUp');
  const [gmailStep, setGmailStep] = useState<GmailStep>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [gmailPassword, setGmailPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('chooser');
  const [gmailRecoveryStep, setGmailRecoveryStep] = useState<GmailRecoveryStep>('email');

  const canShowAccount = Boolean(session && userEmail && !isAnonymous);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setInfo(null);
    setRootView('login');
    setSimpleMode('signUp');
    setGmailStep('email');
    setOtp('');
    setGmailPassword('');
    setPassword('');
    setShowPassword(false);
    setResendCooldown(0);
    setRecoveryMode('chooser');
    setGmailRecoveryStep('email');

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setUserEmail(data.session?.user.email ?? null);
      setIsAnonymous(Boolean(data.session?.user.is_anonymous) || !data.session?.user.email);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUserEmail(nextSession?.user.email ?? null);
      setIsAnonymous(Boolean(nextSession?.user.is_anonymous) || !nextSession?.user.email);
    });

    return () => {
      authSub.subscription.unsubscribe();
    };
  }, [visible]);

  const handleSignInSubmit = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);

    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
      setSession((await supabase.auth.getSession()).data.session);
      setIsAnonymous(false);
      onClose();
    } catch (e) {
      setError('We couldn\'t sign you in just now. Please check your details and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSimpleSignUpSubmit = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);

    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      const result = await signUpWithEmail(email.trim(), password);
      setUserEmail(email.trim());
      setIsAnonymous(false);
      if (result.session) {
        setInfo('Account created. You are now signed in.');
      } else {
        setInfo('Account created. Check your email to confirm the account, then sign in.');
      }
    } catch (e) {
      setError('We couldn\'t create your account just now. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const sendGmailCode = async (targetEmail = email.trim()) => {
    if (busy) return;
    if (!targetEmail) {
      setError('Enter your Gmail address first.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await sendEmailOtp(targetEmail, true);
      setEmail(targetEmail);
      setGmailStep('code');
      setInfo('We sent a verification code to your inbox.');
      setResendCooldown(60);
    } catch (e) {
      setError('We couldn\'t send that code just now. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const verifyGmailCode = async () => {
    if (busy) return;
    if (!email.trim() || otp.trim().length < 4) {
      setError('Enter the verification code from your email.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await verifyEmailOtp(email.trim(), otp.trim());
      setGmailStep('password');
      setInfo('Code verified. Create your password.');
    } catch (e) {
      setError('That code did not work. Check it and try again.');
    } finally {
      setBusy(false);
    }
  };

  const finalizeGmailPassword = async () => {
    if (busy) return;
    if (gmailPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setCurrentUserPassword(gmailPassword);
      setSession((await supabase.auth.getSession()).data.session);
      setUserEmail(email.trim());
      setIsAnonymous(false);
      setInfo('Password saved. You are now signed in.');
      onClose();
    } catch (e) {
      setError('We couldn\'t save your password just now. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    setRecoveryMode('chooser');
    setRootView('recovery');
  };

  const sendGmailRecoveryCode = async (targetEmail = email.trim()) => {
    if (busy) return;
    if (!targetEmail) {
      setError('Enter your Gmail address first.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await sendPasswordResetEmail(targetEmail);
      setEmail(targetEmail);
      setGmailRecoveryStep('code');
      setInfo('We sent a recovery code to your inbox.');
      setResendCooldown(60);
    } catch (e) {
      setError('We couldn\'t send that recovery code just now. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const verifyGmailRecoveryCode = async () => {
    if (busy) return;
    if (!email.trim() || otp.trim().length < 4) {
      setError('Enter the recovery code from your email.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await verifyRecoveryOtp(email.trim(), otp.trim());
      setGmailRecoveryStep('password');
      setInfo('Code verified. Create a new password.');
    } catch (e) {
      setError('That recovery code did not work. Check it and try again.');
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
      setError('We couldn\'t sign you out just now. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const BackButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.backButton} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="chevron-back" size={14} color="#111827" />
      <Text style={styles.backButtonText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderLogin = () => (
    <>
      <Text style={styles.subtitle}>Sign in to your account, or create one if you’re new.</Text>
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
      <View style={styles.passwordWrapper}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password"
          placeholderTextColor="#9CA3AF"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          onPress={() => setShowPassword((v) => !v)}
          hitSlop={12}
          style={styles.showPasswordButton}
        >
          <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={handleForgotPassword} hitSlop={8}>
        <Text style={styles.switchText}>Forgot password?</Text>
      </TouchableOpacity>
      {info ? <Text style={styles.info}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={handleSignInSubmit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.signupButton}
        onPress={() => setRootView('signupChooser')}
        disabled={busy}
        activeOpacity={0.85}
      >
        <Text style={styles.signupButtonText}>Sign Up</Text>
        <Ionicons name="chevron-forward" size={16} color="#166534" />
      </TouchableOpacity>
    </>
  );

  const renderSignupChooser = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <BackButton label="Back to sign in" onPress={() => setRootView('login')} />
        <Text style={styles.subtitle}>Choose how you want to create your new account.</Text>
      </View>
      <TouchableOpacity style={styles.choiceCard} onPress={() => setRootView('simple')} activeOpacity={0.85}>
        <View style={styles.choiceIcon}>
          <Ionicons name="person-outline" size={20} color="#16A34A" />
        </View>
        <View style={styles.choiceText}>
          <Text style={styles.choiceTitle}>Simple sign up</Text>
          <Text style={styles.choiceSubtitle}>Email + password. Fast demo flow.</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.choiceCard}
        onPress={() => setRootView('gmail')}
        activeOpacity={0.85}
      >
        <View style={styles.choiceIcon}>
          <Ionicons name="mail-outline" size={20} color="#16A34A" />
        </View>
        <View style={styles.choiceText}>
          <Text style={styles.choiceTitle}>Continue with Gmail</Text>
          <Text style={styles.choiceSubtitle}>Code in inbox, then set a password.</Text>
        </View>
      </TouchableOpacity>
    </>
  );

  const renderRecovery = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <BackButton label="Back to sign in" onPress={() => setRootView('login')} />
        <Text style={styles.subtitle}>Forget password? Recovery it here.</Text>
      </View>
      {recoveryMode === 'chooser' && (
        <>
          <TouchableOpacity style={styles.choiceCard} onPress={() => setRecoveryMode('simple')} activeOpacity={0.85}>
            <View style={styles.choiceIcon}>
              <Ionicons name="person-outline" size={20} color="#16A34A" />
            </View>
            <View style={styles.choiceText}>
              <Text style={styles.choiceTitle}>Simple Sign-up Account</Text>
              <Text style={styles.choiceSubtitle}>Recovery unavailable for simple accounts.</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.choiceCard}
            onPress={() => {
              setRecoveryMode('gmail');
              setGmailRecoveryStep('email');
              setOtp('');
              setGmailPassword('');
              setResendCooldown(0);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.choiceIcon}>
              <Ionicons name="mail-outline" size={20} color="#16A34A" />
            </View>
            <View style={styles.choiceText}>
              <Text style={styles.choiceTitle}>Gmail Account</Text>
              <Text style={styles.choiceSubtitle}>Verify a code from your inbox.</Text>
            </View>
          </TouchableOpacity>
        </>
      )}

      {recoveryMode === 'simple' && (
        <View style={styles.recoveryCard}>
          <Text style={styles.recoveryLead}>
            Your password is stored securely.
          </Text>
          <Text style={styles.recoveryBody}>
            Simple Sign-up account passwords are hashed irreversibly, so neither the app nor the backend can retrieve your original password.
          </Text>
          <View style={styles.recoveryDivider} />
          <Text style={styles.recoveryCaption}>
            Recommended: use Gmail sign-up so you can recover access later with an email verification code.
          </Text>
          <Text style={styles.recoveryCaption}>
            Backup: contact the Atlas team and we will help you restore access.
          </Text>
        </View>
      )}

      {recoveryMode === 'gmail' && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Gmail address"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {gmailRecoveryStep === 'email' && (
            <TouchableOpacity style={styles.button} onPress={() => sendGmailRecoveryCode(email.trim())} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Send recovery code</Text>}
            </TouchableOpacity>
          )}
          {gmailRecoveryStep === 'code' && (
            <>
              <View style={styles.otpRow}>
                <TextInput
                  style={styles.otpInput}
                  placeholder="Recovery code"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  value={otp}
                  onChangeText={setOtp}
                />
                <TouchableOpacity
                  style={[styles.otpResendButton, resendCooldown > 0 && styles.otpResendButtonDisabled]}
                  onPress={() => {
                    if (resendCooldown > 0 || busy) return;
                    sendGmailRecoveryCode(email.trim());
                  }}
                  disabled={busy || resendCooldown > 0}
                >
                  <Text style={styles.otpResendButtonText}>
                    {resendCooldown > 0 ? `Resend ${resendCooldown}s` : 'Resend'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.button} onPress={verifyGmailRecoveryCode} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Verify code</Text>}
              </TouchableOpacity>
            </>
          )}
          {gmailRecoveryStep === 'password' && (
            <>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Create new password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPassword}
                  value={gmailPassword}
                  onChangeText={setGmailPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={12}
                  style={styles.showPasswordButton}
                >
                  <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.button} onPress={finalizeGmailPassword} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Update password</Text>}
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </>
  );

  const renderSimple = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <BackButton label="Back to sign up" onPress={() => setRootView('signupChooser')} />
        <Text style={styles.subtitle}>Simple registration keeps the original demo-friendly email/password flow.</Text>
      </View>
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
      <View style={styles.passwordWrapper}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password (min 6 characters)"
          placeholderTextColor="#9CA3AF"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          onPress={() => setShowPassword((v) => !v)}
          hitSlop={12}
          style={styles.showPasswordButton}
        >
          <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>
      {info ? <Text style={styles.info}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={handleSimpleSignUpSubmit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Create Account</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderGmail = () => (
    <>
      
      {gmailStep === 'email' && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Gmail address"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TouchableOpacity style={styles.button} onPress={() => sendGmailCode()} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Send code</Text>}
          </TouchableOpacity>
        </>
      )}

      {gmailStep === 'code' && (
        <>
          <Text style={styles.inlineHint}>We sent a code to {email}. Enter it below.</Text>
          <View style={styles.otpRow}>
            <TextInput
              style={styles.otpInput}
              placeholder="Verification code"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
            />
            <TouchableOpacity
              style={[styles.otpResendButton, resendCooldown > 0 && styles.otpResendButtonDisabled]}
              onPress={() => {
                if (resendCooldown > 0 || busy) return;
                sendGmailCode(email.trim());
              }}
              disabled={busy || resendCooldown > 0}
            >
              <Text style={styles.otpResendButtonText}>
                {resendCooldown > 0 ? `Resend ${resendCooldown}s` : 'Resend'}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.button} onPress={verifyGmailCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Verify code</Text>}
          </TouchableOpacity>
        </>
      )}

      {gmailStep === 'password' && (
        <>
          <Text style={styles.inlineHint}>Set the password for {email}.</Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Create password"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              value={gmailPassword}
              onChangeText={setGmailPassword}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={12}
              style={styles.showPasswordButton}
            >
              <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.button} onPress={finalizeGmailPassword} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Finish registration</Text>}
          </TouchableOpacity>
        </>
      )}

      {info ? <Text style={styles.info}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );

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

          {canShowAccount ? (
            <>
      <Text style={styles.subtitle}>Signed in as</Text>
              <Text style={styles.emailText}>{userEmail || session?.user.email || 'Account'}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleSignOut} disabled={busy}>
                {busy ? <ActivityIndicator /> : <Text style={styles.secondaryButtonText}>Log Out</Text>}
              </TouchableOpacity>
            </>
          ) : rootView === 'login' ? (
            renderLogin()
          ) : rootView === 'signupChooser' ? (
            renderSignupChooser()
          ) : rootView === 'recovery' ? (
            renderRecovery()
          ) : rootView === 'simple' ? (
            renderSimple()
          ) : (
            renderGmail()
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderCurve: 'continuous',
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  closeText: { fontSize: 18, color: '#6B7280' },
  subtitle: { fontSize: 14, color: '#6B7280' },
  emailText: { fontSize: 16, fontWeight: '600', color: '#111827' },
  choiceCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FAFAFA',
  },
  choiceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
  },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  choiceSubtitle: { fontSize: 13, color: '#6B7280' },
  sectionHeaderRow: { gap: 8 },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  backButtonText: { color: '#111827', fontWeight: '600', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  passwordWrapper: { position: 'relative', justifyContent: 'center' },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 56,
    fontSize: 15,
    color: '#111827',
  },
  showPasswordButton: { position: 'absolute', right: 14 },
  showPasswordText: { color: '#16A34A', fontSize: 13, fontWeight: '600' },
  inlineHint: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
  recoveryCard: {
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    gap: 10,
  },
  recoveryLead: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  recoveryBody: {
    color: '#4B5563',
    fontSize: 13,
    lineHeight: 19,
  },
  recoveryDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  recoveryCaption: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
  },
  inlineRow: { flexDirection: 'row', gap: 8 },
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  otpInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    borderRightWidth: 0,
  },
  otpResendButton: {
    minWidth: 96,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  otpResendButtonDisabled: { opacity: 0.5 },
  otpResendButtonText: { color: '#111827', fontSize: 15, fontWeight: '600' },
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
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: { color: '#111827', fontSize: 15, fontWeight: '600' },
  signupButton: {
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#F0FDF4',
  },
  signupButtonText: { color: '#166534', fontSize: 15, fontWeight: '700' },
  switchText: { color: '#16A34A', fontSize: 13, textAlign: 'center', marginTop: 4 },
});
