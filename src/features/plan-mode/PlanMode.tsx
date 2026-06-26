import { View, Text } from 'react-native';

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
}: PlanModeProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Plan Mode</Text>
    </View>
  );
}
