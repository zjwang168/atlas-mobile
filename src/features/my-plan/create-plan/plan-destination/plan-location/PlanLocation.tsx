import { memo } from 'react';
import { Input } from '@/components/ui/input';

type PlanLocationProps = {
  value: string;
  onChangeText: (value: string) => void;
};

const INPUT_STYLE = { paddingVertical: 0 };

function PlanLocation({ value, onChangeText }: PlanLocationProps) {
  return (
    <Input
      placeholder="Where are you going?"
      value={value}
      onChangeText={onChangeText}
      className="mb-3 rounded-xl"
      style={INPUT_STYLE}
    />
  );
}

export default memo(PlanLocation);
