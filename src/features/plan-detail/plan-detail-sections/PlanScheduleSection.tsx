import { Linking, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { mockPlaceDetails } from '../../../../mock-data/mockPlaceDetails';
import type { SavedPlan, PlanDateSlot } from '../../create-plan/savePlan';
import type { PlannedPlace, VisitSlot } from '../../create-plan/plan-place/types';

const SLOT_ORDER: VisitSlot[] = ['morning', 'noon', 'afternoon', 'night'];
const SLOT_LABELS: Record<VisitSlot, string> = {
  morning: 'Morning',
  noon: 'Noon',
  afternoon: 'Afternoon',
  night: 'Night',
};

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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

function findPlaceDetailById(id: string) {
  return mockPlaceDetails.find((p) => p.id === id);
}

function PlaceRow({ place }: { place: PlannedPlace }) {
  const detail = findPlaceDetailById(place.placeId);

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color: '#09090b' }}>{place.name}</Text>
      {detail?.address ? (
        <Text style={{ fontSize: 12, color: 'rgba(60,60,67,0.6)', marginTop: 2 }}>
          {detail.address}
        </Text>
      ) : (
        <Text style={{ fontSize: 12, color: 'rgba(60,60,67,0.6)', marginTop: 2 }}>
          {place.subtitle}
        </Text>
      )}
      {detail?.summary ? (
        <Text
          numberOfLines={3}
          style={{ fontSize: 12, color: '#3c3c43', marginTop: 4, lineHeight: 17 }}
        >
          {detail.summary}
        </Text>
      ) : null}
      {detail?.links && detail.links.length > 0 ? (
        <Pressable
          onPress={() => detail.links?.[0] && Linking.openURL(detail.links[0].url)}
          style={{ marginTop: 6 }}
        >
          <Text style={{ fontSize: 12, color: '#3c3c43' }}>Links ›</Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 12, color: '#3c3c43', marginTop: 4 }}>Commute</Text>
    </View>
  );
}

function DaySection({ day }: { day: PlanDateSlot }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 15, fontWeight: '500', color: '#09090b', marginBottom: 10 }}>
        {formatDate(day.date)}
      </Text>
      {SLOT_ORDER.map((slot) => {
        const places = day.slots[slot];
        if (!places || places.length === 0) return null;
        return (
          <View key={slot}>
            <Text style={{ fontSize: 13, color: '#8b8b8b', marginBottom: 8 }}>
              {SLOT_LABELS[slot]}
            </Text>
            <View style={{ paddingLeft: 20 }}>
              {places.map((place) => (
                <PlaceRow key={place.id} place={place} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

type PlanScheduleSectionProps = {
  plan: SavedPlan;
};

export default function PlanScheduleSection({ plan }: PlanScheduleSectionProps) {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
      {plan.freePlaces.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#8b8b8b', marginBottom: 8 }}>Flexible</Text>
          <View style={{ paddingLeft: 20 }}>
            {plan.freePlaces.map((place) => (
              <PlaceRow key={place.id} place={place} />
            ))}
          </View>
        </View>
      )}
      {plan.schedule.map((day) => (
        <DaySection key={day.date} day={day} />
      ))}
    </View>
  );
}
