import { describe, it, expect } from 'vitest';
import {
  GAME_CONFIG,
  LEARNING_LEVELS,
  MASTERY_LEVELS,
  EXPERIENCE_CONFIG,
  UI_CONFIG,
  STORAGE_KEYS,
  API_ENDPOINTS,
} from './constants';

describe('GAME_CONFIG', () => {
  it('has vocabulary points per correct answer', () => {
    expect(GAME_CONFIG.VOCABULARY.POINTS_PER_CORRECT).toBe(10);
  });

  it('has sentence points per correct answer', () => {
    expect(GAME_CONFIG.SENTENCE.POINTS_PER_CORRECT).toBe(15);
  });

  it('has session timeout of 30 minutes in ms', () => {
    expect(GAME_CONFIG.GENERAL.SESSION_TIMEOUT).toBe(30 * 60 * 1000);
  });

  it('has auto save interval of 10 seconds in ms', () => {
    expect(GAME_CONFIG.GENERAL.AUTO_SAVE_INTERVAL).toBe(10 * 1000);
  });
});

describe('LEARNING_LEVELS', () => {
  it('has 5 defined levels', () => {
    expect(Object.keys(LEARNING_LEVELS)).toHaveLength(5);
  });

  it('BEGINNER is level 1', () => {
    expect(LEARNING_LEVELS.BEGINNER).toBe(1);
  });

  it('EXPERT is level 5', () => {
    expect(LEARNING_LEVELS.EXPERT).toBe(5);
  });

  it('levels are sequential from 1 to 5', () => {
    const values = [...Object.values(LEARNING_LEVELS)].sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('MASTERY_LEVELS', () => {
  it('NEW starts at 0', () => {
    expect(MASTERY_LEVELS.NEW).toBe(0);
  });

  it('EXPERT is highest at 5', () => {
    expect(MASTERY_LEVELS.EXPERT).toBe(5);
  });

  it('has 6 mastery levels', () => {
    expect(Object.keys(MASTERY_LEVELS)).toHaveLength(6);
  });
});

describe('EXPERIENCE_CONFIG', () => {
  it('vocabulary correct gives 10 XP', () => {
    expect(EXPERIENCE_CONFIG.VOCABULARY_CORRECT).toBe(10);
  });

  it('sentence correct gives 15 XP', () => {
    expect(EXPERIENCE_CONFIG.SENTENCE_CORRECT).toBe(15);
  });

  it('level up bonus is 100 XP', () => {
    expect(EXPERIENCE_CONFIG.LEVEL_UP_BONUS).toBe(100);
  });
});

describe('UI_CONFIG', () => {
  it('mobile breakpoint is 768', () => {
    expect(UI_CONFIG.MOBILE_BREAKPOINT).toBe(768);
  });

  it('animation duration is 300ms', () => {
    expect(UI_CONFIG.ANIMATION_DURATION).toBe(300);
  });

  it('toast duration is 3000ms', () => {
    expect(UI_CONFIG.TOAST_DURATION).toBe(3000);
  });
});

describe('STORAGE_KEYS', () => {
  it('has user preferences key', () => {
    expect(STORAGE_KEYS.USER_PREFERENCES).toBe('user_preferences');
  });

  it('has game state key', () => {
    expect(STORAGE_KEYS.GAME_STATE).toBe('game_state');
  });

  it('has 4 storage keys defined', () => {
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(4);
  });
});

describe('API_ENDPOINTS', () => {
  it('auth login endpoint is correct', () => {
    expect(API_ENDPOINTS.AUTH.LOGIN).toBe('/auth/login');
  });

  it('auth logout endpoint is correct', () => {
    expect(API_ENDPOINTS.AUTH.LOGOUT).toBe('/auth/logout');
  });

  it('progress stats endpoint is correct', () => {
    expect(API_ENDPOINTS.PROGRESS.STATS).toBe('/progress/stats');
  });

  it('chat history endpoint is correct', () => {
    expect(API_ENDPOINTS.CHAT.HISTORY).toBe('/chat/history');
  });
});
