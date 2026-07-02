import { Input } from '@/components/ui/input';

type PlanLocationProps = {
  value: string;
  onChangeText: (value: string) => void;
};

export default function PlanLocation({ value, onChangeText }: PlanLocationProps) {
  return (
    <Input
      placeholder="Where are you going?"
      value={value}
      onChangeText={onChangeText}
      className="mb-3 rounded-xl"
      style={{ paddingVertical: 0 }}
    />
  );
}
