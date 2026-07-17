import { memo, useMemo } from 'react';
import { Calendar, DateData } from 'react-native-calendars';
import type { DateRange } from '../../CreatePlan';

type PlanDateProps = {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
};

function buildMarkedDates(range: DateRange): Record<string, object> {
  const { start, end } = range;
  if (!start) return {};
  if (!end || end === start) {
    return { [start]: { startingDay: true, endingDay: true, color: '#09090b', textColor: '#fff' } };
  }

  const marks: Record<string, object> = {};
  const cursor = new Date(start);
  const endDate = new Date(end);

  while (cursor <= endDate) {
    const key = cursor.toISOString().split('T')[0];
    const isStart = key === start;
    const isEnd = key === end;
    marks[key] = {
      startingDay: isStart,
      endingDay: isEnd,
      color: isStart || isEnd ? '#09090b' : '#e5e5ea',
      textColor: isStart || isEnd ? '#fff' : '#09090b',
    };
    cursor.setDate(cursor.getDate() + 1);
  }
  return marks;
}

const CALENDAR_THEME = {
  calendarBackground: '#fafafa',
  selectedDayBackgroundColor: '#09090b',
  selectedDayTextColor: '#fff',
  todayTextColor: '#09090b',
  dayTextColor: '#09090b',
  textDisabledColor: '#c7c7cc',
  arrowColor: '#09090b',
  monthTextColor: '#09090b',
  textMonthFontWeight: '600' as const,
  textDayFontSize: 13,
  textMonthFontSize: 15,
  textDayHeaderFontSize: 12,
};

const CALENDAR_STYLE = { borderRadius: 14, overflow: 'hidden' as const };

function PlanDate({ range, onRangeChange }: PlanDateProps) {
  function handleDayPress(day: DateData) {
    const { start, end } = range;
    if (!start || (start && end) || day.dateString < start) {
      onRangeChange({ start: day.dateString, end: null });
    } else {
      onRangeChange({ start, end: day.dateString });
    }
  }

  const markedDates = useMemo(() => buildMarkedDates(range), [range]);
  const minDate = useMemo(() => new Date().toISOString().split('T')[0], []);

  return (
    <Calendar
      onDayPress={handleDayPress}
      markingType="period"
      markedDates={markedDates}
      minDate={minDate}
      style={CALENDAR_STYLE}
      theme={CALENDAR_THEME}
    />
  );
}

export default memo(PlanDate);
