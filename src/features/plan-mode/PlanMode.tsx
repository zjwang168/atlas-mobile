import { View } from 'react-native';
import { Text } from '@/components/ui/text';

import { ChatMessage, ParseResult } from '../../types/route';

type PlanModeProps = {
  parseResult: ParseResult | null;
  isLoading: boolean;
  loadingMessage?: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  error: string | null;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
};

export default function PlanMode({
  parseResult,
  isLoading,
  loadingMessage,
  messages,
  onSendMessage,
  error,
  onScroll,
  bottomInset = 0,
  compact = false,
}: PlanModeProps) {
  if (compact) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 8,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>
          Playbook
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Plan Mode</Text>
    </View>
  );
}
