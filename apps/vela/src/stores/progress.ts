import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  progressService,
  type ProgressAnalytics,
  type Achievement,
  type SkillCategory,
} from '../services/progressService';
import { queryClient, QUERY_STALE_TIME } from '../boot/query';
import { progressKeys } from '@vela/common';
import { useAuthStore } from './auth';

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
  const analytics = ref<ProgressAnalytics | null>(null);
  const achievements = ref<Achievement[]>([]);
  const skillCategories = ref<SkillCategory[]>([]);
  const isLoading = ref(false);
  const newAchievements = ref<Achievement[]>([]);

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

  const currentLevelProgress = computed(() => {
    if (!analytics.value) return 0;
    const currentExp = analytics.value.totalExperience;
    const expForCurrentLevel = (analytics.value.currentLevel - 1) * 100;
    const expForNextLevel = analytics.value.currentLevel * 100;
    return ((currentExp - expForCurrentLevel) / (expForNextLevel - expForCurrentLevel)) * 100;
  });

  const dailyProgressChart = computed(() => {
    if (!analytics.value) return [];
    return analytics.value.dailyProgress
      .slice(0, 7)
      .reverse()
      .map((day) => ({
        date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }),
        experience: day.experience_gained,
        vocabulary: day.vocabulary_studied,
        sentences: day.sentences_completed,
        accuracy: day.accuracy_percentage,
      }));
  });

  const weeklyProgressChart = computed(() => {
    if (!analytics.value) return [];
    return analytics.value.weeklyProgress.map((day) => ({
      date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      experience: day.experience_gained,
      vocabulary: day.vocabulary_studied,
      sentences: day.sentences_completed,
      accuracy: day.accuracy_percentage,
    }));
  });

  const monthlyProgressChart = computed(() => {
    if (!analytics.value) return [];
    return analytics.value.monthlyProgress.map((day) => ({
      date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      experience: day.experience_gained,
      vocabulary: day.vocabulary_studied,
      sentences: day.sentences_completed,
      accuracy: day.accuracy_percentage,
    }));
  });

  const recentAchievements = computed(() => {
    return achievements.value
      .filter((a) => a.earned_at)
      .sort((a, b) => new Date(b.earned_at!).getTime() - new Date(a.earned_at!).getTime())
      .slice(0, 5);
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

  const loadProgressAnalytics = async (userId: string | null) => {
    try {
      setLoading(true);

      // Fall back to current user from auth store if userId not provided
      const authStore = useAuthStore();
      const effectiveUserId = userId ?? authStore.user?.id ?? null;

      const queryKey = progressKeys.analytics(effectiveUserId);
      const queryState = queryClient.getQueryState(queryKey);

      // Check if cached data is fresh (not invalidated AND not stale)
      // staleTime is 5 minutes (from @vela/query)
      const isInvalidated = queryState?.isInvalidated ?? true;
      const dataAge = queryState?.dataUpdatedAt ? Date.now() - queryState.dataUpdatedAt : Infinity;
      const isStale = dataAge > QUERY_STALE_TIME;

      // Only use cached data if it's fresh (not invalidated AND not stale)
      const isFresh = !isInvalidated && !isStale && queryState?.data;
      const cachedData = isFresh ? queryClient.getQueryData<ProgressAnalytics>(queryKey) : null;

      const data = cachedData || (await progressService.getProgressAnalytics());

      // Update cache with fresh data using the effective user ID
      if (data && effectiveUserId) {
        queryClient.setQueryData(queryKey, data);
      }

      analytics.value = data;
      achievements.value = data.achievements || [];
      skillCategories.value = data.skillCategories;

      // Update learning stats for backward compatibility
      setLearningStats({
        totalWordsLearned: data.wordsLearned || 0,
        currentStreak: data.learningStreak?.current_streak || 0,
        level: data.currentLevel || 1,
        experience: data.totalExperience,
        experienceToNextLevel: data.experienceToNextLevel,
      });
    } catch (error) {
      console.error('Failed to load progress analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const recordGameSession = async (
    gameType: string,
    score: number,
    durationSeconds: number,
    questionsAnswered: number,
    correctAnswers: number,
    userId: string | null = null,
  ) => {
    try {
      const experienceGained = calculateExperienceGained(score, correctAnswers, questionsAnswered);

      await progressService.recordGameSession(
        gameType,
        score,
        durationSeconds,
        questionsAnswered,
        correctAnswers,
        experienceGained,
      );

      // Achievement checking is now handled by the API

      // Invalidate progress queries to trigger refetch
      queryClient.invalidateQueries({ queryKey: progressKeys.all });

      // Reload analytics to get updated data
      await loadProgressAnalytics(userId);
    } catch (error) {
      console.error('Failed to record game session:', error);
    }
  };

  const calculateExperienceGained = (
    score: number,
    correctAnswers: number,
    totalQuestions: number,
  ): number => {
    const baseExp = correctAnswers * 10;
    const accuracyBonus =
      totalQuestions > 0 ? Math.floor((correctAnswers / totalQuestions) * 50) : 0;
    const perfectBonus = correctAnswers === totalQuestions && totalQuestions > 0 ? 25 : 0;
    return baseExp + accuracyBonus + perfectBonus;
  };

  const dismissNewAchievements = () => {
    newAchievements.value = [];
  };

  const getSkillCategoryProgress = (categoryName: string) => {
    return skillCategories.value.find((sc) => sc.name === categoryName) || null;
  };

  const getTodayProgress = () => {
    if (!analytics.value?.dailyProgress.length) return null;
    const today = new Date().toISOString().split('T')[0];
    return analytics.value.dailyProgress.find((d) => d.date === today) || null;
  };

  return {
    // State
    userProgress,
    learningStats,
    analytics,
    achievements,
    skillCategories,
    newAchievements,
    isLoading,
    // Getters
    masteredWords,
    wordsInProgress,
    averageAccuracy,
    weeklyGoalProgress,
    currentLevelProgress,
    dailyProgressChart,
    weeklyProgressChart,
    monthlyProgressChart,
    recentAchievements,
    // Actions
    updateProgress,
    addExperience,
    updateWeeklyProgress,
    setLearningStats,
    setUserProgress,
    setLoading,
    loadProgressAnalytics,
    recordGameSession,
    calculateExperienceGained,
    dismissNewAchievements,
    getSkillCategoryProgress,
    getTodayProgress,
  };
});
