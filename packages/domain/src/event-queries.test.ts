import { describe, expect, it } from 'vitest';
import type { Event } from '@carlog/contracts';
import { searchEvents, sumSpend, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from './event-queries';

const ev = (over: Partial<Event> & { id: string; date: string }): Event => ({
  carId: 'car-1', ownerId: 'owner-1', category: 'other', mileage: 0, cost: 0,
  currency: 'UAH', title: undefined, notes: undefined, works: [],
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const timeline: Event[] = [
  ev({ id: 'a', date: '2019-11-26', category: 'inspection', cost: 500, title: 'Antifreeze check' }),
  ev({ id: 'b', date: '2023-06-01', category: 'oil_change', cost: 1200, title: 'Oil and filter' }),
  ev({ id: 'c', date: '2024-02-17', category: 'brakes', cost: 3000, title: 'Front pads' }),
  ev({ id: 'd', date: '2025-01-10', category: 'oil_change', cost: 60, currency: 'USD', title: 'Oil top-up' }),
];

describe('searchEvents', () => {
  it('returns everything newest-first when no filter is given', () => {
    expect(searchEvents(timeline, {}).map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('filters by category', () => {
    expect(searchEvents(timeline, { category: 'oil_change' }).map((e) => e.id)).toEqual(['d', 'b']);
  });

  it('filters by an inclusive date range', () => {
    expect(searchEvents(timeline, { from: '2023-06-01', to: '2024-02-17' }).map((e) => e.id))
      .toEqual(['c', 'b']);
  });

  it('matches text case-insensitively across title, notes, works and parts', () => {
    const rich = ev({
      id: 'e', date: '2026-01-01', notes: 'Replaced the STABILIZER links',
      works: [{ description: 'Suspension', parts: [{ name: 'Bilstein strut', quantity: 2 }] }],
    });
    const all = [...timeline, rich];
    expect(searchEvents(all, { text: 'stabilizer' }).map((e) => e.id)).toEqual(['e']);
    expect(searchEvents(all, { text: 'bilstein' }).map((e) => e.id)).toEqual(['e']);
    expect(searchEvents(all, { text: 'front pads' }).map((e) => e.id)).toEqual(['c']);
  });

  it('matches text in work.description only', () => {
    const withDesc = ev({
      id: 'f', date: '2026-01-02',
      works: [{ description: 'Replace cabin filter', parts: [] }],
    });
    const all = [...timeline, withDesc];
    expect(searchEvents(all, { text: 'cabin filter' }).map((e) => e.id)).toEqual(['f']);
  });

  it('matches text in part.brand only', () => {
    const withBrand = ev({
      id: 'g', date: '2026-01-03',
      works: [{ description: '', parts: [{ name: 'filter', brand: 'MANN-FILTER', partNumber: '', quantity: 1, notes: '' }] }],
    });
    const all = [...timeline, withBrand];
    expect(searchEvents(all, { text: 'mann-filter' }).map((e) => e.id)).toEqual(['g']);
  });

  it('matches text in part.partNumber only', () => {
    const withPartNum = ev({
      id: 'h', date: '2026-01-04',
      works: [{ description: '', parts: [{ name: '', brand: '', partNumber: 'CUK-2643', quantity: 1, notes: '' }] }],
    });
    const all = [...timeline, withPartNum];
    expect(searchEvents(all, { text: 'cuk-2643' }).map((e) => e.id)).toEqual(['h']);
  });

  it('matches text in part.notes only', () => {
    const withNotes = ev({
      id: 'i', date: '2026-01-05',
      works: [{ description: '', parts: [{ name: '', brand: '', partNumber: '', quantity: 1, notes: 'OEM original part' }] }],
    });
    const all = [...timeline, withNotes];
    expect(searchEvents(all, { text: 'oem original' }).map((e) => e.id)).toEqual(['i']);
  });

  it('does not mutate the input array', () => {
    const withSort = ev({
      id: 'j', date: '2024-06-15', category: 'oil_change',
      works: [{ description: 'filter change', parts: [] }],
    });
    const mutable = [...timeline, withSort];
    const originalIds = mutable.map((e) => e.id);

    searchEvents(mutable, { category: 'oil_change' });

    expect(mutable.map((e) => e.id)).toEqual(originalIds);
  });

  it('returns a different array reference than the input', () => {
    const result = searchEvents(timeline, {});
    expect(result).not.toBe(timeline);
  });

  it('applies the default limit and clamps an oversized one', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      ev({ id: `x${i}`, date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` }));
    expect(searchEvents(many, {})).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect(searchEvents(many, { limit: 999 })).toHaveLength(SEARCH_MAX_LIMIT);
    expect(searchEvents(many, { limit: 3 })).toHaveLength(3);
  });

  it('returns [] for an empty timeline', () => {
    expect(searchEvents([], { category: 'brakes' })).toEqual([]);
  });
});

describe('sumSpend', () => {
  it('groups totals per currency and counts matches', () => {
    expect(sumSpend(timeline, {})).toEqual({
      totals: [{ currency: 'UAH', total: 4700 }, { currency: 'USD', total: 60 }],
      count: 4,
    });
  });

  it('respects the category filter', () => {
    expect(sumSpend(timeline, { category: 'oil_change' })).toEqual({
      totals: [{ currency: 'UAH', total: 1200 }, { currency: 'USD', total: 60 }],
      count: 2,
    });
  });

  it('respects the date range', () => {
    expect(sumSpend(timeline, { from: '2024-01-01' })).toEqual({
      totals: [{ currency: 'UAH', total: 3000 }, { currency: 'USD', total: 60 }],
      count: 2,
    });
  });

  it('returns no totals when nothing matches', () => {
    expect(sumSpend(timeline, { category: 'tires' })).toEqual({ totals: [], count: 0 });
  });
});
