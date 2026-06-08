import { DayOfWeek, DaySchedule, TimeSlot } from '../../../types/place';

export type OpenStatus = {
  isOpen: boolean;
  todayLabel: string;
  statusLine: string;
};

export const orderedDays: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export function getOpenStatus(schedule: DaySchedule[]): OpenStatus {
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const today = orderedDays[todayIndex];
  const todaySchedule = schedule.find((day) => day.day === today);
  const todayLabel = formatDaySlots(todaySchedule?.slots ?? []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const activeSlot = todaySchedule?.slots.find((slot) =>
    isMinuteInSlot(nowMinutes, slot)
  );

  if (activeSlot) {
    return {
      isOpen: true,
      todayLabel,
      statusLine: `Open · Closes at ${formatTime(activeSlot.close)}`,
    };
  }

  const nextOpening = findNextOpening(schedule, todayIndex, nowMinutes);

  if (!nextOpening) {
    return {
      isOpen: false,
      todayLabel,
      statusLine: 'Closed',
    };
  }

  return {
    isOpen: false,
    todayLabel,
    statusLine: `Closed · Opens ${nextOpening}`,
  };
}

export function formatDaySlots(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return 'Closed';
  }

  return slots.map(formatTimeSlot).join('\n');
}

function findNextOpening(
  schedule: DaySchedule[],
  todayIndex: number,
  nowMinutes: number
): string | undefined {
  for (let offset = 0; offset < orderedDays.length; offset += 1) {
    const dayIndex = (todayIndex + offset) % orderedDays.length;
    const daySchedule = schedule.find((entry) => entry.day === orderedDays[dayIndex]);
    const candidateSlot = daySchedule?.slots.find((slot) => {
      if (offset > 0) {
        return true;
      }

      return parseMinutes(slot.open) > nowMinutes;
    });

    if (candidateSlot) {
      const dayLabel = offset === 0 ? 'today' : toShortDay(orderedDays[dayIndex]);
      return `${dayLabel} at ${formatTime(candidateSlot.open)}`;
    }
  }

  return undefined;
}

function isMinuteInSlot(minute: number, slot: TimeSlot): boolean {
  const open = parseMinutes(slot.open);
  const close = parseMinutes(slot.close);
  const normalizedClose = close <= open ? close + 24 * 60 : close;
  const normalizedMinute = minute < open && close <= open ? minute + 24 * 60 : minute;

  return normalizedMinute >= open && normalizedMinute < normalizedClose;
}

function formatTimeSlot(slot: TimeSlot): string {
  return `${formatTime(slot.open)} – ${formatTime(slot.close)}`;
}

function formatTime(value: string): string {
  const [hourValue, minuteValue] = value.split(':').map(Number);
  const suffix = hourValue >= 12 ? 'PM' : 'AM';
  const hour = hourValue % 12 || 12;

  return `${hour}:${String(minuteValue).padStart(2, '0')} ${suffix}`;
}

function parseMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);

  return hours * 60 + minutes;
}

function toShortDay(day: DayOfWeek): string {
  return day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase());
}
