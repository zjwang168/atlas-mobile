import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';

type DialogTone = 'info' | 'warning' | 'danger';

export type AppDialogAction = {
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  onPress?: (value: string) => void;
};

export type AppDialogOptions = {
  title: string;
  message?: string;
  tone?: DialogTone;
  actions?: AppDialogAction[];
  input?: {
    placeholder: string;
    initialValue?: string;
  };
};

type AppDialogContextValue = {
  show: (options: AppDialogOptions) => void;
  dismiss: () => void;
};

const AppDialogContext = createContext<AppDialogContextValue>({
  show: () => {},
  dismiss: () => {},
});

const toneConfig: Record<DialogTone, { icon: keyof typeof Ionicons.glyphMap; color: string; background: string }> = {
  info: { icon: 'sparkles-outline', color: '#16845B', background: '#E9FBF1' },
  warning: { icon: 'alert-circle-outline', color: '#A66300', background: '#FFF4E5' },
  danger: { icon: 'alert-circle-outline', color: '#C0392B', background: '#FDECEC' },
};

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<AppDialogOptions | null>(null);
  const [value, setValue] = useState('');

  const dismiss = useCallback(() => {
    setDialog(null);
    setValue('');
  }, []);

  const show = useCallback((options: AppDialogOptions) => {
    setValue(options.input?.initialValue ?? '');
    setDialog(options);
  }, []);

  const handleAction = useCallback((action: AppDialogAction) => {
    const submittedValue = value;
    dismiss();
    requestAnimationFrame(() => action.onPress?.(submittedValue));
  }, [dismiss, value]);

  const contextValue = useMemo(() => ({ show, dismiss }), [dismiss, show]);
  const tone = dialog ? toneConfig[dialog.tone ?? 'info'] : toneConfig.info;
  const actions = dialog?.actions?.length ? dialog.actions : [{ label: 'Done', variant: 'primary' as const }];

  return (
    <AppDialogContext.Provider value={contextValue}>
      {children}
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(dialog)}
        statusBarTranslucent
        onRequestClose={dismiss}
      >
        <View style={[styles.backdrop, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
          {dialog ? (
            <View accessibilityViewIsModal style={styles.dialog}>
              <View style={[styles.iconWrap, { backgroundColor: tone.background }]}>
                <Ionicons name={tone.icon} size={24} color={tone.color} />
              </View>
              <Text style={styles.title}>{dialog.title}</Text>
              {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
              {dialog.input ? (
                <TextInput
                  autoFocus
                  value={value}
                  onChangeText={setValue}
                  placeholder={dialog.input.placeholder}
                  placeholderTextColor="#9B9B9B"
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    const primary = actions.find((action) => action.variant === 'primary') ?? actions[0];
                    handleAction(primary);
                  }}
                />
              ) : null}
              <View style={styles.actions}>
                {actions.map((action) => {
                  const variant = action.variant ?? 'secondary';
                  return (
                    <Pressable
                      key={action.label}
                      accessibilityRole="button"
                      onPress={() => handleAction(action)}
                      style={({ pressed }) => [
                        styles.action,
                        variant === 'primary' && styles.actionPrimary,
                        variant === 'destructive' && styles.actionDestructive,
                        pressed && styles.actionPressed,
                      ]}
                    >
                      <Text style={[
                        styles.actionText,
                        variant === 'primary' && styles.actionTextPrimary,
                        variant === 'destructive' && styles.actionTextDestructive,
                      ]}>
                        {action.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog() {
  return useContext(AppDialogContext);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 16, 13, 0.38)',
    paddingHorizontal: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    borderCurve: 'continuous',
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(24, 45, 35, 0.1)',
    shadowColor: '#09120D',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 12,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { color: '#171D19', fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 0 },
  message: { color: '#5B625D', fontSize: 15, lineHeight: 22, marginTop: 8, letterSpacing: 0 },
  input: {
    minHeight: 46,
    marginTop: 18,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#D8E0DB',
    color: '#171D19',
    fontSize: 16,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  action: {
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#D7DFDA',
    backgroundColor: '#FFFFFF',
  },
  actionPrimary: { borderColor: '#16845B', backgroundColor: '#16845B' },
  actionDestructive: { borderColor: '#C0392B', backgroundColor: '#C0392B' },
  actionPressed: { opacity: 0.72 },
  actionText: { color: '#3F4A43', fontSize: 15, fontWeight: '600', letterSpacing: 0 },
  actionTextPrimary: { color: '#FFFFFF' },
  actionTextDestructive: { color: '#FFFFFF' },
});
