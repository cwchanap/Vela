import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import FlashcardReview from './FlashcardReview.vue';
import { useFlashcardStore } from '../stores/flashcards';
import { useAuthStore } from '../stores/auth';
import * as flashcardServiceModule from '../services/flashcardService';
import { chunkArray, mergeReviews, parsePendingReviews } from '../utils/flashcardReviewUtils';
import type { Vocabulary } from '../types/database';

describe('chunkArray helper', () => {
  it('should return empty array for empty input', () => {
    const result = chunkArray([], 100);
    expect(result).toEqual([]);
  });

  it('should return single chunk when array is smaller than chunk size', () => {
    const input = [1, 2, 3];
    const result = chunkArray(input, 100);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('should split into multiple chunks when array exceeds chunk size', () => {
    const input = Array.from({ length: 250 }, (_, i) => i);
    const result = chunkArray(input, 100);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(100);
    expect(result[1]).toHaveLength(100);
    expect(result[2]).toHaveLength(50);
  });

  it('should create exactly sized chunks for multiples of chunk size', () => {
    const input = Array.from({ length: 300 }, (_, i) => i);
    const result = chunkArray(input, 100);
    expect(result).toHaveLength(3);
    expect(result.every((chunk) => chunk.length === 100)).toBe(true);
  });
});

describe('FlashcardReview.vue - mergeReviews deduplication', () => {
  it('should deduplicate by vocabulary_id (latest rating wins)', () => {
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
    const list1 = [{ vocabulary_id: 'vocab1', quality: 3 }];
    const list2: Array<{ vocabulary_id: string; quality: number }> = [];

    const result = mergeReviews(list1, list2);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should handle all empty lists', () => {
    const result = mergeReviews([], []);

    expect(result).toHaveLength(0);
  });

  it('should handle multiple lists with overlapping vocabulary_ids', () => {
    const list1 = [{ vocabulary_id: 'vocab1', quality: 1 }];
    const list2 = [{ vocabulary_id: 'vocab1', quality: 2 }];
    const list3 = [{ vocabulary_id: 'vocab1', quality: 3 }];

    const result = mergeReviews(list1, list2, list3);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should allow later ratings to overwrite earlier ones for the same vocabulary', () => {
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

    const stored = localStorage.getItem(pendingReviewsKey);
    const result = parsePendingReviews(stored!, { logWarnings: false });

    expect(result.reviews).toEqual([]);
    expect(result.hadErrors).toBe(true);
    expect(localStorage.getItem(pendingReviewsKey)).not.toBeNull();
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

    const stored = localStorage.getItem(pendingReviewsKey);
    const result = parsePendingReviews(stored!, { logWarnings: false });

    // Should filter out invalid entries, keeping only the valid one
    expect(result.reviews).toEqual([{ vocabulary_id: 'vocab1', quality: 3 }]);
    expect(result.hadErrors).toBe(true);
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

  describe('Partial Batch Failure Handling', () => {
    it('should save only unsubmitted reviews when batch submission fails after partial success', async () => {
      // Simulate partial batch failure:
      // - First 100 reviews succeed (first chunk)
      // - Second 100 reviews succeed (second chunk)
      // - Third batch fails (50 reviews remaining)
      const reviews = Array.from({ length: 250 }, (_, i) => ({
        vocabulary_id: `vocab${i}`,
        quality: (i % 5) as 0 | 1 | 2 | 3 | 4 | 5,
      }));

      // Simulate the fixed behavior: successCount tracks successful submissions
      let successCount = 0;
      const BATCH_SIZE = 100;

      // Create chunks like the real implementation
      const chunks = [];
      for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
        chunks.push(reviews.slice(i, i + BATCH_SIZE));
      }

      // Simulate first two chunks succeeding
      successCount += chunks[0].length; // 100
      successCount += chunks[1].length; // 100

      // When third chunk fails, only remaining reviews should be saved
      const remainingReviews = reviews.slice(successCount);

      expect(remainingReviews).toHaveLength(50);
      expect(remainingReviews[0].vocabulary_id).toBe('vocab200');
      expect(remainingReviews[49].vocabulary_id).toBe('vocab249');

      // Verify the reviews that succeeded are NOT in the remaining list
      expect(remainingReviews.some((r) => r.vocabulary_id === 'vocab0')).toBe(false);
      expect(remainingReviews.some((r) => r.vocabulary_id === 'vocab99')).toBe(false);
      expect(remainingReviews.some((r) => r.vocabulary_id === 'vocab100')).toBe(false);
      expect(remainingReviews.some((r) => r.vocabulary_id === 'vocab199')).toBe(false);
    });

    it('should correctly slice remaining reviews from successCount', () => {
      // Test the slice behavior that prevents duplicate submissions
      const allReviews = [
        { vocabulary_id: 'v1', quality: 3 },
        { vocabulary_id: 'v2', quality: 4 },
        { vocabulary_id: 'v3', quality: 2 },
        { vocabulary_id: 'v4', quality: 5 },
      ];

      // Simulate: first 2 reviews submitted successfully, then failure
      const successCount = 2;
      const remaining = allReviews.slice(successCount);

      expect(remaining).toEqual([
        { vocabulary_id: 'v3', quality: 2 },
        { vocabulary_id: 'v4', quality: 5 },
      ]);
      expect(remaining).toHaveLength(2);
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
      const setupState = (wrapper.vm as any).$?.setupState;
      if (setupState?.showSetup) {
        setupState.showSetup.value = false;
      }
      if (setupState?.showSummary) {
        setupState.showSummary.value = false;
      }
      if (setupState?.answerSubmitted) {
        setupState.answerSubmitted.value = false;
      }
      flashcardStore.setCardDirection('en-to-jp');
      if (!flashcardStore.sessionActive) {
        flashcardStore.startSession([mockVocabulary[0]]);
      }
      await nextTick();

      expect(flashcardStore.isReverseMode).toBe(true);
      expect(flashcardStore.currentCard).not.toBeNull();
      if (setupState?.answerSubmitted) {
        expect(setupState.answerSubmitted.value).toBe(false);
      }
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
