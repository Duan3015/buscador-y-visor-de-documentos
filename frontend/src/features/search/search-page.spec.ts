import { parsePageParam } from './search-page';

describe('parsePageParam', () => {
  it.each([
    [null, 1],
    ['1', 1],
    ['7', 7],
    ['50', 50],
    ['51', 1],
    ['0', 1],
    ['-2', 1],
    ['abc', 1],
    ['2.5', 1],
    ['', 1],
  ])('interpreta %p como pagina %p', (input, expected) => {
    expect(parsePageParam(input)).toBe(expected);
  });
});
