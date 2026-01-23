import { describe, it, expect, vi, afterEach } from 'vitest';
import { shuffleArray } from './array';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shuffleArray', () => {
  it('returns a new array without mutating the original', () => {
    const original = [1, 2, 3, 4];
    const result = shuffleArray(original);

    expect(result).not.toBe(original);
    expect(result).toHaveLength(original.length);
    expect(original).toEqual([1, 2, 3, 4]);
    expect(result.slice().sort()).toEqual(original.slice().sort());
  });

  it('shuffles deterministically when Math.random is mocked', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = shuffleArray([1, 2, 3, 4]);

    expect(result).toEqual([2, 3, 4, 1]);
  });
});
