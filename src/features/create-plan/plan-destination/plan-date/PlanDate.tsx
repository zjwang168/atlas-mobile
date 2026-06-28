import { Calendar, DateData } from 'react-native-calendars';

type DateRange = { start: string | null; end: string | null };

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

export default function PlanDate({ range, onRangeChange }: PlanDateProps) {
  function handleDayPress(day: DateData) {
    const { start, end } = range;
    if (!start || (start && end) || day.dateString < start) {
      onRangeChange({ start: day.dateString, end: null });
    } else {
      onRangeChange({ start, end: day.dateString });
    }
  }

  return (
    <Calendar
      onDayPress={handleDayPress}
      markingType="period"
      markedDates={buildMarkedDates(range)}
      minDate={new Date().toISOString().split('T')[0]}
      style={{ borderRadius: 14, overflow: 'hidden' }}
      theme={{
        calendarBackground: '#fafafa',
        selectedDayBackgroundColor: '#09090b',
        selectedDayTextColor: '#fff',
        todayTextColor: '#09090b',
        dayTextColor: '#09090b',
        textDisabledColor: '#c7c7cc',
        arrowColor: '#09090b',
        monthTextColor: '#09090b',
        textMonthFontWeight: '600',
        textDayFontSize: 13,
        textMonthFontSize: 15,
        textDayHeaderFontSize: 12,
      }}
    />
  );
}
