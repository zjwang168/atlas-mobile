import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { findSavedPlan } from '../create-plan/savePlan';
import type { SavedPlan } from '../create-plan/savePlan';
import { seedMockPlanDetails } from '../../../mock-data/mockPlanDetails';
import PlanCompactView from './PlanCompactView';
import PlanScheduleSection from './plan-detail-sections/PlanScheduleSection';

// Seed mock data once at module load
seedMockPlanDetails();

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start + 'T00:00:00');
  const sLabel = `${MONTHS[s.getMonth()]} ${ordinal(s.getDate())}`;
  if (!end || end === start) return `${sLabel}, ${s.getFullYear()}`;
  const e = new Date(end + 'T00:00:00');
  const eLabel = `${MONTHS[e.getMonth()]} ${ordinal(e.getDate())}`;
  const sameYear = s.getFullYear() === e.getFullYear();
  return sameYear
    ? `${sLabel} – ${eLabel}, ${e.getFullYear()}`
    : `${sLabel}, ${s.getFullYear()} – ${eLabel}, ${e.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function PlanHeader({ plan, onDismiss }: { plan: SavedPlan; onDismiss: () => void }) {
  const colorScheme = useColorScheme();
  const fg = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';
  const dateLabel = formatDateRange(plan.dateRange.start, plan.dateRange.end);

  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}>
      {/* Title row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: 48 }}>
        <View style={{ flex: 1, paddingTop: 2 }}>
          <Text
            style={{ fontSize: 24, fontWeight: '500', lineHeight: 30, color: '#09090b' }}
            numberOfLines={1}
          >
            {plan.title}
          </Text>
          {plan.location ? (
            <Text
              style={{ fontSize: 12, lineHeight: 16, color: 'rgba(60,60,67,0.6)', marginTop: 2 }}
              numberOfLines={1}
            >
              {plan.location}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Button size="icon" variant="ghost" className="h-12 w-12 rounded-full bg-background">
            <Ionicons name="share-outline" size={20} color={fg} />
          </Button>
          <Button size="icon" variant="ghost" className="h-12 w-12 rounded-full bg-background">
            <Ionicons name="pencil-outline" size={20} color={fg} />
          </Button>
          <Button
            accessibilityLabel="Dismiss plan details"
            onPress={onDismiss}
            size="icon"
            variant="ghost"
            className="h-12 w-12 rounded-full bg-background"
          >
            <Ionicons name="close" size={24} color={fg} />
          </Button>
        </View>
      </View>

      {/* Date range */}
      {dateLabel ? (
        <Text style={{ fontSize: 15, fontWeight: '500', color: '#09090b', marginTop: 10 }}>
          {dateLabel}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type PlanDetailProps = {
  planId: string | null;
  onDismiss: () => void;
};

export default function PlanDetail({ planId, onDismiss }: PlanDetailProps) {
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (planId) {
      findSavedPlan(planId).then((found) => {
        if (found) setPlan(found);
      });
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [planId]);

  return (
    <ContentPanel
      initialSnap="default"
      visible={isVisible}
      onHidden={() => {
        setPlan(null);
        onDismiss();
      }}
      zIndex={40}
      compactContent={({ snapTo }) =>
        plan ? (
          <PlanCompactView
            plan={plan}
            onDismiss={() => setIsVisible(false)}
            onExpand={() => snapTo('default')}
          />
        ) : null
      }
    >
      {({ reportScrollY, bottomInset }) => {
        if (!plan) return null;
        return (
          <>
            <PlanHeader plan={plan} onDismiss={() => setIsVisible(false)} />
            <ScrollView
              bounces
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
              contentContainerStyle={{ paddingBottom: bottomInset + 56 }}
            >
              <PlanScheduleSection plan={plan} />
            </ScrollView>
          </>
        );
      }}
    </ContentPanel>
  );
}
