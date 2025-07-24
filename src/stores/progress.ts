import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface UserProgress {
  vocabulary_id: string;
  mastery_level: number;
  correct_attempts: number;
  total_attempts: number;
  last_reviewed: Date;
  next_review: Date;
}

export interface LearningStats {
  totalWordsLearned: number;
  currentStreak: number;
  weeklyGoal: number;
  weeklyProgress: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
}

export const useProgressStore = defineStore('progress', () => {
  // State
  const userProgress = ref<UserProgress[]>([]);
  const learningStats = ref<LearningStats>({
    totalWordsLearned: 0,
    currentStreak: 0,
    weeklyGoal: 50,
    weeklyProgress: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
  });
  const isLoading = ref(false);

  // Getters
  const masteredWords = computed(
    () => userProgress.value.filter((p) => p.mastery_level >= 5).length,
  );

  const wordsInProgress = computed(
    () => userProgress.value.filter((p) => p.mastery_level > 0 && p.mastery_level < 5).length,
  );

  const averageAccuracy = computed(() => {
    if (userProgress.value.length === 0) return 0;
    const totalAccuracy = userProgress.value.reduce((sum, p) => {
      return sum + (p.total_attempts > 0 ? (p.correct_attempts / p.total_attempts) * 100 : 0);
    }, 0);
    return totalAccuracy / userProgress.value.length;
  });

  const weeklyGoalProgress = computed(() => {
    return Math.min(
      (learningStats.value.weeklyProgress / learningStats.value.weeklyGoal) * 100,
      100,
    );
  });

  // Actions
  const updateProgress = (vocabularyId: string, isCorrect: boolean) => {
    const existingProgress = userProgress.value.find((p) => p.vocabulary_id === vocabularyId);

    if (existingProgress) {
      existingProgress.total_attempts++;
      if (isCorrect) {
        existingProgress.correct_attempts++;
        existingProgress.mastery_level = Math.min(existingProgress.mastery_level + 1, 5);
      } else {
        existingProgress.mastery_level = Math.max(existingProgress.mastery_level - 1, 0);
      }
      existingProgress.last_reviewed = new Date();
      // Calculate next review based on spaced repetition
      const daysToAdd = Math.pow(2, existingProgress.mastery_level);
      existingProgress.next_review = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
    } else {
      // Create new progress entry
      const newProgress: UserProgress = {
        vocabulary_id: vocabularyId,
        mastery_level: isCorrect ? 1 : 0,
        correct_attempts: isCorrect ? 1 : 0,
        total_attempts: 1,
        last_reviewed: new Date(),
        next_review: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
      };
      userProgress.value.push(newProgress);
    }
  };

  const addExperience = (points: number) => {
    learningStats.value.experience += points;

    // Check for level up
    while (learningStats.value.experience >= learningStats.value.experienceToNextLevel) {
      learningStats.value.experience -= learningStats.value.experienceToNextLevel;
      learningStats.value.level++;
      learningStats.value.experienceToNextLevel = learningStats.value.level * 100;
    }
  };

  const updateWeeklyProgress = (increment: number = 1) => {
    learningStats.value.weeklyProgress += increment;
  };

  const setLearningStats = (stats: Partial<LearningStats>) => {
    learningStats.value = { ...learningStats.value, ...stats };
  };

  const setUserProgress = (progress: UserProgress[]) => {
    userProgress.value = progress;
  };

  const setLoading = (loading: boolean) => {
    isLoading.value = loading;
  };

  return {
    // State
    userProgress,
    learningStats,
    isLoading,
    // Getters
    masteredWords,
    wordsInProgress,
    averageAccuracy,
    weeklyGoalProgress,
    // Actions
    updateProgress,
    addExperience,
    updateWeeklyProgress,
    setLearningStats,
    setUserProgress,
    setLoading,
  };
});
