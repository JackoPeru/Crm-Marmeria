export interface AppointmentLike {
  id?: string;
  startAt?: string;
  date?: string;
  [key: string]: unknown;
}

export const pad = (value: number): string => String(value).padStart(2, '0');

export const localDateKey = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const startOfLocalDay = (value: Date | string | number = new Date()): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const appointmentsForDay = <T extends AppointmentLike>(appointments: T[] = [], day: Date | string | number = new Date()): T[] => {
  const key = localDateKey(day);
  return appointments
    .filter((appointment) => localDateKey(appointment.startAt || appointment.date || '') === key)
    .sort((left, right) => new Date(left.startAt || left.date || '').getTime() - new Date(right.startAt || right.date || '').getTime());
};

export const todayAndTomorrow = <T extends AppointmentLike>(appointments: T[] = [], now: Date = new Date()): { today: T[]; tomorrow: T[] } => {
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    today: appointmentsForDay(appointments, today),
    tomorrow: appointmentsForDay(appointments, tomorrow),
  };
};

export const nextLocalMidnightDelay = (now: Date = new Date()): number => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
};
