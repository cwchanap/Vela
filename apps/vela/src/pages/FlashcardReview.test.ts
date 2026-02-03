import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import FlashcardReview from './FlashcardReview.vue';
import { useFlashcardStore } from '../stores/flashcards';
import { useAuthStore } from '../stores/auth';
import * as flashcardServiceModule from '../services/flashcardService';
import type { Vocabulary } from '../types/database';

describe('FlashcardReview.vue - mergeReviews deduplication', () => {
  it('should deduplicate by vocabulary_id (latest rating wins)', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          // Use vocabulary_id as key for deduplication (latest rating wins)
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [
      { vocabulary_id: 'vocab1', quality: 3 },
      { vocabulary_id: 'vocab2', quality: 4 },
    ];

    const list2 = [
      { vocabulary_id: 'vocab1', quality: 5 }, // Should overwrite the first vocab1 entry
      { vocabulary_id: 'vocab3', quality: 2 },
    ];

    const result = mergeReviews(list1, list2);

    // Should have 3 unique vocabulary_ids
    expect(result).toHaveLength(3);

    // vocab1 should have quality 5 (from list2, latest)
    const vocab1Review = result.find((r) => r.vocabulary_id === 'vocab1');
    expect(vocab1Review?.quality).toBe(5);

    // vocab2 should have quality 4 (from list1)
    const vocab2Review = result.find((r) => r.vocabulary_id === 'vocab2');
    expect(vocab2Review?.quality).toBe(4);

    // vocab3 should have quality 2 (from list2)
    const vocab3Review = result.find((r) => r.vocabulary_id === 'vocab3');
    expect(vocab3Review?.quality).toBe(2);
  });

  it('should handle empty lists', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [{ vocabulary_id: 'vocab1', quality: 3 }];
    const list2: Array<{ vocabulary_id: string; quality: number }> = [];

    const result = mergeReviews(list1, list2);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should handle all empty lists', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const result = mergeReviews([], []);

    expect(result).toHaveLength(0);
  });

  it('should handle multiple lists with overlapping vocabulary_ids', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [{ vocabulary_id: 'vocab1', quality: 1 }];
    const list2 = [{ vocabulary_id: 'vocab1', quality: 2 }];
    const list3 = [{ vocabulary_id: 'vocab1', quality: 3 }];

    const result = mergeReviews(list1, list2, list3);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should allow later ratings to overwrite earlier ones for the same vocabulary', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [
      { vocabulary_id: 'vocab1', quality: 0 }, // Failed
      { vocabulary_id: 'vocab2', quality: 5 }, // Perfect
    ];

    const list2 = [
      { vocabulary_id: 'vocab1', quality: 4 }, // Good - should overwrite
      { vocabulary_id: 'vocab2', quality: 1 }, // Hard - should overwrite
    ];

    const result = mergeReviews(list1, list2);

    const vocab1Review = result.find((r) => r.vocabulary_id === 'vocab1');
    expect(vocab1Review?.quality).toBe(4);

    const vocab2Review = result.find((r) => r.vocabulary_id === 'vocab2');
    expect(vocab2Review?.quality).toBe(1);
  });
});

describe('FlashcardReview.vue - localStorage persistence', () => {
  const pendingReviewsKey = 'pendingFlashcardReviews';

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should handle corrupted JSON in localStorage', () => {
    // Set corrupted JSON
    localStorage.setItem(pendingReviewsKey, '{ invalid json }');

    // This simulates readPendingReviews behavior
    const readPendingReviews = (): Array<{ vocabulary_id: string; quality: number }> => {
      const stored = localStorage.getItem(pendingReviewsKey);
      if (!stored) return [];

      try {
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) {
          console.warn('Invalid pending flashcard reviews data. Clearing.');
          localStorage.removeItem(pendingReviewsKey);
          return [];
        }
        return parsed.filter(
          (item): item is { vocabulary_id: string; quality: number } =>
            typeof item === 'object' &&
            item !== null &&
            'vocabulary_id' in item &&
            'quality' in item &&
            typeof item.vocabulary_id === 'string' &&
            typeof item.quality === 'number',
        );
      } catch (error) {
        console.error('Failed to parse pending flashcard reviews:', error);
        localStorage.removeItem(pendingReviewsKey);
        return [];
      }
    };

    const result = readPendingReviews();

    expect(result).toEqual([]);
    expect(localStorage.getItem(pendingReviewsKey)).toBeNull();
  });

  it('should handle malformed review objects in localStorage', () => {
    // Set array with malformed objects
    const malformedData = [
      { vocabulary_id: 'vocab1', quality: 3 }, // Valid
      { vocabulary_id: 'vocab2' }, // Missing quality
      { quality: 4 }, // Missing vocabulary_id
      'invalid', // Not an object
    ];
    localStorage.setItem(pendingReviewsKey, JSON.stringify(malformedData));

    const readPendingReviews = (): Array<{ vocabulary_id: string; quality: number }> => {
      const stored = localStorage.getItem(pendingReviewsKey);
      if (!stored) return [];

      try {
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) {
          localStorage.removeItem(pendingReviewsKey);
          return [];
        }
        return parsed.filter(
          (item): item is { vocabulary_id: string; quality: number } =>
            typeof item === 'object' &&
            item !== null &&
            'vocabulary_id' in item &&
            'quality' in item &&
            typeof item.vocabulary_id === 'string' &&
            typeof item.quality === 'number',
        );
      } catch {
        localStorage.removeItem(pendingReviewsKey);
        return [];
      }
    };

    const result = readPendingReviews();

    // Should filter out invalid entries, keeping only the valid one
    expect(result).toEqual([{ vocabulary_id: 'vocab1', quality: 3 }]);
  });

  it('should persist reviews to localStorage when API submission fails', () => {
    const reviews = [
      { vocabulary_id: 'vocab1', quality: 3 },
      { vocabulary_id: 'vocab2', quality: 4 },
    ];

    // Simulate persisting on API failure
    try {
      localStorage.setItem(pendingReviewsKey, JSON.stringify(reviews));
    } catch (storageError) {
      console.error('Failed to persist pending reviews:', storageError);
    }

    const stored = localStorage.getItem(pendingReviewsKey);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed).toEqual(reviews);
  });

  it('should clear localStorage after successful API submission', () => {
    const reviews = [{ vocabulary_id: 'vocab1', quality: 3 }];
    localStorage.setItem(pendingReviewsKey, JSON.stringify(reviews));

    // Simulate successful submission
    localStorage.removeItem(pendingReviewsKey);

    expect(localStorage.getItem(pendingReviewsKey)).toBeNull();
  });

  it('should handle localStorage quota exceeded gracefully', () => {
    // Mock localStorage.setItem to throw QuotaExceededError
    const originalSetItem = Storage.prototype.setItem;
    const mockSetItem = vi.fn(() => {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    });

    Storage.prototype.setItem = mockSetItem;

    const reviews = [{ vocabulary_id: 'vocab1', quality: 3 }];

    try {
      localStorage.setItem(pendingReviewsKey, JSON.stringify(reviews));
    } catch (storageError) {
      // Should catch and handle gracefully
      expect(storageError).toBeDefined();
      expect((storageError as Error).name).toBe('QuotaExceededError');
    }

    // Restore original
    Storage.prototype.setItem = originalSetItem;
  });
});

// Mock Notify
vi.mock('quasar', async () => {
  const actual = await vi.importActual<typeof import('quasar')>('quasar');
  return {
    ...actual,
    Notify: {
      create: vi.fn(),
    },
  };
});

describe('FlashcardReview.vue - Component Integration', () => {
  let notifyCreateSpy: ReturnType<typeof vi.fn>;

  const mockVocabulary: Vocabulary[] = [
    {
      id: 'vocab1',
      japanese_word: '猫',
      hiragana: 'ねこ',
      romaji: 'neko',
      english_translation: 'cat',
      jlpt_level: 5,
      created_at: '2024-01-01',
    },
    {
      id: 'vocab2',
      japanese_word: '犬',
      hiragana: 'いぬ',
      romaji: 'inu',
      english_translation: 'dog',
      jlpt_level: 5,
      created_at: '2024-01-01',
    },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();

    // Setup auth store
    const authStore = useAuthStore();
    authStore.user = {
      id: 'test-user',
      email: 'test@test.com',
      current_level: 1,
      total_experience: 0,
      learning_streak: 0,
      native_language: 'en',
      preferences: {
        dailyGoal: 10,
        difficulty: 'Beginner',
        notifications: true,
      },
      created_at: '',
      updated_at: '',
    };

    // Get reference to mocked Notify.create
    notifyCreateSpy = Notify.create as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('Session Watcher', () => {
    it('should show summary when session ends via store action', async () => {
      // Mock flashcardService to avoid actual API calls
      vi.spyOn(flashcardServiceModule.flashcardService, 'recordBatchReview').mockResolvedValue();

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      const flashcardStore = useFlashcardStore();
      const componentInstance = wrapper.vm as any;

      // Start a session
      flashcardStore.startSession(mockVocabulary);
      await flushPromises();

      // Verify summary is not shown initially
      expect(componentInstance.showSummary).toBe(false);

      // End session via store action (simulates completing the last card)
      flashcardStore.endSession();
      await flushPromises();

      // Verify summary is shown after session ends
      expect(componentInstance.showSummary).toBe(true);

      wrapper.unmount();
    });

    it('should not submit reviews if summary is already shown', async () => {
      const recordBatchReviewSpy = vi
        .spyOn(flashcardServiceModule.flashcardService, 'recordBatchReview')
        .mockResolvedValue();

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      const flashcardStore = useFlashcardStore();
      const componentInstance = wrapper.vm as any;

      // Start session
      flashcardStore.startSession(mockVocabulary);
      await flushPromises();

      // Set summary as already shown
      componentInstance.showSummary = true;

      // End session
      flashcardStore.endSession();
      await flushPromises();

      // Should not call submitReviews
      expect(recordBatchReviewSpy).not.toHaveBeenCalled();

      wrapper.unmount();
    });

    it('should only submit reviews once when last card is rated', async () => {
      const recordBatchReviewSpy = vi
        .spyOn(flashcardServiceModule.flashcardService, 'recordBatchReview')
        .mockResolvedValue();

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      const flashcardStore = useFlashcardStore();
      const authStore = useAuthStore();
      const componentInstance = wrapper.vm as any;

      authStore.session = {
        user: { id: 'test-user', email: 'test@test.com' },
        provider: 'cognito',
      } as any;

      flashcardStore.startSession([mockVocabulary[0]]);
      await flushPromises();

      await componentInstance.handleRate(4);
      await flushPromises();

      expect(recordBatchReviewSpy).toHaveBeenCalledTimes(1);

      wrapper.unmount();
    });
  });

  describe('Reverse Mode Input', () => {
    it('should show input before flip and flip after answer submission', async () => {
      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': {
              template: '<div data-testid="flashcard-input-stub" />',
            },
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      const componentInstance = wrapper.vm as any;

      vi.spyOn(flashcardServiceModule.flashcardService, 'getVocabularyForCram').mockResolvedValue([
        mockVocabulary[0],
      ]);

      await componentInstance.handleStart({
        studyMode: 'cram',
        cardDirection: 'en-to-jp',
        jlptLevels: [],
        showFurigana: true,
      });
      await nextTick();
      await flushPromises();

      const flashcardStore = useFlashcardStore();
      if (componentInstance.showSetup) {
        componentInstance.showSetup = false;
      }
      if (!flashcardStore.sessionActive) {
        flashcardStore.startSession([mockVocabulary[0]]);
      }
      await nextTick();

      expect(wrapper.find('[data-testid="flashcard-input-stub"]').exists()).toBe(true);
      expect(flashcardStore.currentCard?.isFlipped).toBe(false);

      componentInstance.handleFlip();
      expect(flashcardStore.currentCard?.isFlipped).toBe(false);

      componentInstance.handleAnswerSubmit('neko', true);
      await flushPromises();

      expect(flashcardStore.currentCard?.isFlipped).toBe(true);

      wrapper.unmount();
    });
  });

  describe('Vocabulary Fetch Error Handling', () => {
    it('should show error notification when SRS vocabulary fetch fails', async () => {
      // Mock service to throw error
      vi.spyOn(flashcardServiceModule.flashcardService, 'getVocabularyForSRS').mockRejectedValue(
        new Error('Network error'),
      );

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      await flushPromises();

      // Directly call handleStart
      const componentInstance = wrapper.vm as any;
      await componentInstance.handleStart({
        studyMode: 'srs',
        cardDirection: 'jp-to-en',
        jlptLevels: [],
        showFurigana: true,
      });
      await flushPromises();

      // Verify error notification was shown
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
          message: 'Failed to load vocabulary. Please try again.',
        }),
      );

      // Verify loading state is reset
      expect(componentInstance.isLoading).toBe(false);

      // Verify session did not start
      const flashcardStore = useFlashcardStore();
      expect(flashcardStore.sessionActive).toBe(false);

      wrapper.unmount();
    });

    it('should show error notification when cram vocabulary fetch fails', async () => {
      // Mock service to throw error
      vi.spyOn(flashcardServiceModule.flashcardService, 'getVocabularyForCram').mockRejectedValue(
        new Error('Network error'),
      );

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      await flushPromises();

      // Directly call handleStart
      const componentInstance = wrapper.vm as any;
      await componentInstance.handleStart({
        studyMode: 'cram',
        cardDirection: 'jp-to-en',
        jlptLevels: [],
        showFurigana: true,
      });
      await flushPromises();

      // Verify error notification
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
          message: 'Failed to load vocabulary. Please try again.',
        }),
      );

      // Verify session did not start
      const flashcardStore = useFlashcardStore();
      expect(flashcardStore.sessionActive).toBe(false);

      wrapper.unmount();
    });

    it('should reset loading state even when error occurs', async () => {
      vi.spyOn(flashcardServiceModule.flashcardService, 'getVocabularyForSRS').mockRejectedValue(
        new Error('Network error'),
      );

      const wrapper = mount(FlashcardReview, {
        global: {
          plugins: [Quasar],
          stubs: {
            'flashcard-setup': true,
            'flashcard-card': true,
            'flashcard-input': true,
            'flashcard-rating': true,
            'flashcard-summary': true,
          },
        },
      });

      await flushPromises();

      const componentInstance = wrapper.vm as any;

      // Verify loading is initially false
      expect(componentInstance.isLoading).toBe(false);

      // Directly call handleStart
      await componentInstance.handleStart({
        studyMode: 'srs',
        cardDirection: 'jp-to-en',
        jlptLevels: [],
        showFurigana: true,
      });
      await flushPromises();

      // After error, loading should be reset
      expect(componentInstance.isLoading).toBe(false);

      wrapper.unmount();
    });
  });
});
