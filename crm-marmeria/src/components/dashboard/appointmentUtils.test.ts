import { describe, expect, it } from 'vitest';
import { nextLocalMidnightDelay, todayAndTomorrow } from './appointmentUtils';

describe('appointment dashboard grouping', () => {
  it("separa oggi e domani nell'orario locale e ordina per inizio", () => {
    const now = new Date(2031, 5, 3, 12, 0, 0);
    const result = todayAndTomorrow([
      { id: 'tomorrow', startAt: '2031-06-04T09:00:00' },
      { id: 'late', startAt: '2031-06-03T16:00:00' },
      { id: 'early', startAt: '2031-06-03T08:00:00' },
    ], now);
    expect(result.today.map((item) => item.id)).toEqual(['early', 'late']);
    expect(result.tomorrow.map((item) => item.id)).toEqual(['tomorrow']);
  });

  it('ricalcola il gruppo dopo mezzanotte', () => {
    const now = new Date(2031, 5, 3, 23, 59, 59, 500);
    const result = todayAndTomorrow([{ id: 'tomorrow', startAt: '2031-06-04T00:01:00' }], now);
    expect(result.tomorrow).toHaveLength(1);
    expect(nextLocalMidnightDelay(now)).toBe(500);
  });
});
