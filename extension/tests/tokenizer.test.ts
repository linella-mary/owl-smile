import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/core/tokenizer';

const set = new Set(['CatJam', 'OwlYes']);
const has = (c: string) => set.has(c);

describe('tokenize', () => {
  it('возвращает null, если смайлов нет', () => {
    expect(tokenize('привет всем', has)).toBeNull();
    expect(tokenize('', has)).toBeNull();
  });

  it('находит смайл между словами и сохраняет пробелы', () => {
    expect(tokenize('hi CatJam  there', has)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'emote', code: 'CatJam' },
      { type: 'text', value: '  there' },
    ]);
  });

  it('смайлы подряд и в начале/конце строки', () => {
    expect(tokenize('CatJam OwlYes', has)).toEqual([
      { type: 'emote', code: 'CatJam' },
      { type: 'text', value: ' ' },
      { type: 'emote', code: 'OwlYes' },
    ]);
  });

  it('учитывает регистр', () => {
    expect(tokenize('catjam CATJAM', has)).toBeNull();
  });

  it('не трогает части слов, пунктуацию и URL', () => {
    expect(tokenize('CatJam! xCatJam https://x.ru/CatJam', has)).toBeNull();
  });
});
