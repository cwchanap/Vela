import { describe, it, expect } from 'vitest';
import {
  authKeys,
  gameKeys,
  progressKeys,
  savedSentencesKeys,
  dictionaryKeys,
  srsKeys,
  ttsKeys,
} from './keys';

describe('authKeys', () => {
  it('has correct base key', () => {
    expect(authKeys.all).toEqual(['auth']);
  });

  it('session returns correct tuple', () => {
    expect(authKeys.session()).toEqual(['auth', 'session']);
  });

  it('user returns correct tuple', () => {
    expect(authKeys.user()).toEqual(['auth', 'user']);
  });

  it('profile returns correct tuple with userId', () => {
    expect(authKeys.profile('user-1')).toEqual(['auth', 'profile', 'user-1']);
  });

  it('profile handles null userId', () => {
    expect(authKeys.profile(null)).toEqual(['auth', 'profile', null]);
  });
});

describe('gameKeys', () => {
  it('has correct base key', () => {
    expect(gameKeys.all).toEqual(['games']);
  });

  it('vocabulary returns correct tuple', () => {
    expect(gameKeys.vocabulary(10)).toEqual(['games', 'vocabulary', 10]);
  });

  it('sentences returns correct tuple', () => {
    expect(gameKeys.sentences(5)).toEqual(['games', 'sentences', 5]);
  });
});

describe('progressKeys', () => {
  it('has correct base key', () => {
    expect(progressKeys.all).toEqual(['progress']);
  });

  it('analytics returns correct tuple with userId', () => {
    expect(progressKeys.analytics('user-1')).toEqual(['progress', 'analytics', 'user-1']);
  });

  it('analytics handles null userId', () => {
    expect(progressKeys.analytics(null)).toEqual(['progress', 'analytics', null]);
  });

  it('session returns correct tuple', () => {
    expect(progressKeys.session('sess-1')).toEqual(['progress', 'session', 'sess-1']);
  });
});

describe('savedSentencesKeys', () => {
  it('has correct base key', () => {
    expect(savedSentencesKeys.all).toEqual(['saved-sentences']);
  });

  it('list returns correct tuple with limit', () => {
    expect(savedSentencesKeys.list(20)).toEqual(['saved-sentences', 'list', 20]);
  });

  it('list handles undefined limit', () => {
    expect(savedSentencesKeys.list()).toEqual(['saved-sentences', 'list', undefined]);
  });

  it('detail returns correct tuple', () => {
    expect(savedSentencesKeys.detail('abc-123')).toEqual(['saved-sentences', 'detail', 'abc-123']);
  });
});

describe('dictionaryKeys', () => {
  it('has correct base key', () => {
    expect(dictionaryKeys.all).toEqual(['dictionary']);
  });

  it('lookup returns correct tuple', () => {
    expect(dictionaryKeys.lookup('食べる')).toEqual(['dictionary', 'lookup', '食べる']);
  });
});

describe('srsKeys', () => {
  it('has correct base key', () => {
    expect(srsKeys.all).toEqual(['srs']);
  });

  it('due returns correct tuple with limit and jlpt', () => {
    expect(srsKeys.due(10, [3, 4])).toEqual(['srs', 'due', 10, [3, 4]]);
  });

  it('due handles undefined optional params', () => {
    expect(srsKeys.due()).toEqual(['srs', 'due', undefined, undefined]);
  });

  it('due handles limit without jlpt', () => {
    expect(srsKeys.due(20)).toEqual(['srs', 'due', 20, undefined]);
  });

  it('stats returns correct tuple with jlpt', () => {
    expect(srsKeys.stats([2, 3])).toEqual(['srs', 'stats', [2, 3]]);
  });

  it('stats handles undefined jlpt', () => {
    expect(srsKeys.stats()).toEqual(['srs', 'stats', undefined]);
  });

  it('progress returns correct tuple', () => {
    expect(srsKeys.progress('vocab-1')).toEqual(['srs', 'progress', 'vocab-1']);
  });

  it('allProgress returns correct tuple', () => {
    expect(srsKeys.allProgress()).toEqual(['srs', 'all']);
  });
});

describe('ttsKeys', () => {
  it('has correct base key', () => {
    expect(ttsKeys.all).toEqual(['tts']);
  });

  it('settings returns correct tuple with userId', () => {
    expect(ttsKeys.settings('user-1')).toEqual(['tts', 'settings', 'user-1']);
  });

  it('settings handles null userId', () => {
    expect(ttsKeys.settings(null)).toEqual(['tts', 'settings', null]);
  });
});
