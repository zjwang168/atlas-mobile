import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import * as ImagePicker from 'expo-image-picker';
import type { Session, User } from '@supabase/supabase-js';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { ExportIcon } from 'phosphor-react-native/src/icons/Export';
import { NoteIcon } from 'phosphor-react-native/src/icons/Note';
import { PencilSimpleLineIcon } from 'phosphor-react-native/src/icons/PencilSimpleLine';
import { QuestionIcon } from 'phosphor-react-native/src/icons/Question';
import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mockUser } from '../../../mock-data/mockUser';
import { fetchPlans } from '../../services/plan/planService';
import { signOut, supabase } from '../../services/supabase/supabaseClient';
import { typography } from '../../theme/typography';
import TopBlurFade from '../../components/ui/top-blur-fade';
import { useHome } from '../home/HomeContext';

const COLOR = {
  background: '#F7F7F7',
  card: '#FFFFFF',
  primary: '#12C170',
  text: '#1A1A1A',
  secondary: '#717171',
  tertiary: '#B0B0B0',
  border: '#EBEBEB',
  destructive: '#FF3B4D',
} as const;

const NOTIFICATIONS_KEY = '@atlas/profile/notifications-enabled';
const AVATAR_KEY_PREFIX = '@atlas/profile/avatar-uri/';
const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type ProfileSettingsProps = {
  visible: boolean;
  onClose: () => void;
  onRequestSignIn: () => void;
};

function displayNameForUser(user?: User | null): string {
  const metadata = user?.user_metadata ?? {};
  const metadataName = metadata.full_name ?? metadata.display_name ?? metadata.name;
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim();

  const emailName = user?.email?.split('@')[0]?.trim();
  if (emailName) {
    return emailName
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return mockUser.name;
}

function avatarForUser(user?: User | null): string {
  const metadata = user?.user_metadata ?? {};
  const avatar = metadata.avatar_url ?? metadata.picture;
  return typeof avatar === 'string' && avatar.trim() ? avatar : mockUser.avatarUri;
}

function GlassCircleButton({
  accessibilityLabel,
  onPress,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.glassButtonShadow, pressed && styles.pressed]}
    >
      <View style={styles.glassButton}>
        {LIQUID_GLASS_AVAILABLE ? (
          <GlassView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            tintColor="rgba(255,255,255,0.55)"
          />
        ) : (
          <BlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint="systemUltraThinMaterialLight"
            intensity={70}
          />
        )}
        {children}
      </View>
    </Pressable>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[typography.h3, styles.statValue]}>{value}</Text>
      <Text style={[typography.bodySmall, styles.statLabel]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={[typography.bodySmallEmphasis, styles.sectionLabel]}>{children}</Text>;
}

function SettingsRow({
  icon,
  label,
  trailing,
  onPress,
  destructive = false,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  compact?: boolean;
}) {
  const content = (
    <>
      <View style={styles.rowLeading}>
        {icon}
        <Text style={[typography.body, styles.rowLabel, destructive && styles.destructiveText]}>
          {label}
        </Text>
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return <View style={[styles.settingsRow, compact && styles.settingsRowCompact]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        compact && styles.settingsRowCompact,
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

export default function ProfileSettings({
  visible,
  onClose,
  onRequestSignIn,
}: ProfileSettingsProps) {
  const insets = useSafeAreaInsets();
  const { savedPlaces, atlases } = useHome();
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState(mockUser.name);
  const [avatarUri, setAvatarUri] = useState(mockUser.avatarUri);
  const [planCount, setPlanCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const headerTop = Math.max(insets.top, 56);
  const headerOverlayHeight = headerTop + 44 + 32;
  const headerMaterialHeight = headerOverlayHeight+120;

  const isAnonymous = !session?.user || Boolean(session.user.is_anonymous);
  const avatarStorageKey = useMemo(
    () => `${AVATAR_KEY_PREFIX}${session?.user.id ?? 'anonymous'}`,
    [session?.user.id],
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setName(displayNameForUser(data.session?.user));
      setAvatarUri(avatarForUser(data.session?.user));
    });

    void fetchPlans()
      .then((plans) => {
        if (!cancelled) setPlanCount(plans.length);
      })
      .catch((error) => console.warn('[ProfileSettings] Failed to load plans:', error));

    void AsyncStorage.getItem(NOTIFICATIONS_KEY).then((value) => {
      if (!cancelled && value !== null) setNotificationsEnabled(value === 'true');
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setName(displayNameForUser(nextSession?.user));
      setAvatarUri(avatarForUser(nextSession?.user));
    });

    return () => {
      cancelled = true;
      authSubscription.subscription.unsubscribe();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void AsyncStorage.getItem(avatarStorageKey).then((storedAvatar) => {
      if (storedAvatar) setAvatarUri(storedAvatar);
    });
  }, [avatarStorageKey, visible]);

  const handleChooseAvatar = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to choose a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const nextUri = result.assets[0].uri;
    setAvatarUri(nextUri);
    await AsyncStorage.setItem(avatarStorageKey, nextUri);
  }, [avatarStorageKey]);

  const handleEditName = useCallback(() => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Edit name', 'Name editing is currently available in the iOS build.');
      return;
    }

    Alert.prompt('Edit name', undefined, async (value) => {
      const nextName = value?.trim();
      if (!nextName || nextName === name) return;

      const previousName = name;
      setName(nextName);
      const { error } = await supabase.auth.updateUser({
        data: { full_name: nextName, name: nextName },
      });
      if (error) {
        setName(previousName);
        Alert.alert('Couldn’t update name', error.message);
      }
    }, 'plain-text', name);
  }, [name]);

  const handleNotificationChange = useCallback((enabled: boolean) => {
    setNotificationsEnabled(enabled);
    void AsyncStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
  }, []);

  const handleShare = useCallback(() => {
    void Share.share({ message: 'Explore and save places with Atlas.' });
  }, []);

  const handleAccountAction = useCallback(async () => {
    if (isAnonymous) {
      onClose();
      onRequestSignIn();
      return;
    }

    Alert.alert('Log out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void signOut()
            .then(onClose)
            .catch((error) => Alert.alert('Log out failed', error instanceof Error ? error.message : 'Please try again.'));
        },
      },
    ]);
  }, [isAnonymous, onClose, onRequestSignIn]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account',
      'Account deletion is not connected yet. A secure server endpoint is required before this action can be enabled.',
      [{ text: 'OK' }],
    );
  }, []);

  const handleTerms = useCallback(() => {
    Alert.alert('Terms of Use', 'The Terms of Use link will be connected before release.');
  }, []);

  const handleFeedback = useCallback(() => {
    void Linking.openURL('mailto:?subject=Atlas%20feedback');
  }, []);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: headerOverlayHeight,
              paddingBottom: insets.bottom + 16,
            },
          ]}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileBlock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change profile picture"
              onPress={handleChooseAvatar}
              style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]}
            >
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              <View style={styles.cameraBadge}>
                <CameraIcon size={14} color={COLOR.text} weight="fill" />
              </View>
            </Pressable>
            <Text style={[typography.h2, styles.profileName]} numberOfLines={1}>
              {name}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <StatCard value={savedPlaces.length} label="Places" />
            <StatCard value={planCount} label="Atlas" />
            <StatCard value={atlases.length} label="Lists" />
          </View>

          <View style={styles.sections}>
            <View>
              <SectionLabel>Profiles</SectionLabel>
              <View style={styles.card}>
                <SettingsRow
                  icon={<UserIcon size={20} color={COLOR.text} weight="regular" />}
                  label="Name"
                  onPress={handleEditName}
                  trailing={(
                    <View style={styles.trailingName}>
                      <Text style={[typography.body, styles.trailingText]} numberOfLines={1}>{name}</Text>
                      <PencilSimpleLineIcon size={18} color={COLOR.secondary} weight="regular" />
                    </View>
                  )}
                />
              </View>
            </View>

            <View>
              <SectionLabel>Preference</SectionLabel>
              <View style={styles.card}>
                <SettingsRow
                  icon={<BellIcon size={20} color={COLOR.text} weight="regular" />}
                  label="Notification"
                  trailing={(
                    <Switch
                      accessibilityLabel="Notifications"
                      value={notificationsEnabled}
                      onValueChange={handleNotificationChange}
                      trackColor={{ false: '#D7D7DB', true: COLOR.primary }}
                      ios_backgroundColor="#D7D7DB"
                    />
                  )}
                />
              </View>
            </View>

            <View>
              <SectionLabel>About</SectionLabel>
              <View style={[styles.card, styles.multiRowCard]}>
                <SettingsRow
                  icon={<NoteIcon size={20} color={COLOR.text} weight="regular" />}
                  label="Terms of Use"
                  onPress={handleTerms}
                  compact
                />
                <SettingsRow
                  icon={<QuestionIcon size={20} color={COLOR.text} weight="regular" />}
                  label="Help & Feedback"
                  onPress={handleFeedback}
                  compact
                />
              </View>
            </View>

            <View>
              <SectionLabel>Account</SectionLabel>
              <View style={[styles.card, styles.multiRowCard]}>
                <SettingsRow
                  icon={<SignOutIcon size={20} color={COLOR.text} weight="regular" />}
                  label={isAnonymous ? 'Sign in' : 'Log out'}
                  onPress={handleAccountAction}
                  compact
                />
                <SettingsRow
                  icon={<TrashIcon size={20} color={COLOR.destructive} weight="regular" />}
                  label="Delete account"
                  onPress={handleDeleteAccount}
                  destructive
                  compact
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <TopBlurFade
          height={headerMaterialHeight}
          intensity={5}
          tint="systemThinMaterialLight"
          scrim={1}
        />

        <View style={[styles.header, { paddingTop: headerTop }]}>
          <View style={styles.headerControls}>
            <GlassCircleButton accessibilityLabel="Close settings" onPress={onClose}>
              <CaretLeftIcon size={24} color={COLOR.text} weight="regular" />
            </GlassCircleButton>
            <Text style={[typography.h3, styles.headerTitle]}>Settings</Text>
            <GlassCircleButton accessibilityLabel="Share Atlas" onPress={handleShare}>
              <ExportIcon size={24} color={COLOR.text} weight="regular" />
            </GlassCircleButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.background },
  scrollView: { flex: 1 },
  content: {},
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  headerControls: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: COLOR.text, letterSpacing: -0.17 },
  glassButtonShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  glassButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  profileBlock: { alignItems: 'center', gap: 16 },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  avatarImage: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#E5E5EA' },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLOR.border,
    backgroundColor: COLOR.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { maxWidth: '86%', color: COLOR.text, fontWeight: '500', letterSpacing: -0.22 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 24 },
  statCard: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: COLOR.card,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 9,
  },
  statValue: { color: COLOR.text, textAlign: 'center' },
  statLabel: { color: COLOR.secondary },
  sections: { gap: 16, marginTop: 24 },
  sectionLabel: { color: COLOR.tertiary, paddingHorizontal: 16, marginBottom: 4 },
  card: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: COLOR.card,
  },
  multiRowCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 20,
  },
  settingsRow: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingsRowCompact: {
    minHeight: 24,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  rowLeading: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  rowLabel: { color: COLOR.text, letterSpacing: -0.16 },
  rowPressed: { backgroundColor: 'rgba(0,0,0,0.035)' },
  trailingName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  trailingText: { color: COLOR.secondary, letterSpacing: -0.16, flexShrink: 1 },
  destructiveText: { color: COLOR.destructive },
});
