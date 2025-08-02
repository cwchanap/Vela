import { supabase } from './supabase';
import { useAuthStore } from 'src/stores/auth';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  experience_reward: number;
  earned_at?: string;
}

export interface DailyProgress {
  date: string;
  vocabulary_studied: number;
  sentences_completed: number;
  time_spent_minutes: number;
  experience_gained: number;
  games_played: number;
  accuracy_percentage: number;
}

export interface SkillCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  level: number;
  experience: number;
  experience_to_next_level: number;
}

export interface LearningStreak {
  current_streak: number;
  longest_streak: number;
  start_date: string;
  is_active: boolean;
}

export interface WeeklyProgress {
  date: string;
  experience_gained: number;
  vocabulary_studied: number;
  sentences_completed: number;
  accuracy_percentage: number;
}

export interface MonthlyProgress {
  date: string;
  experience_gained: number;
  vocabulary_studied: number;
  sentences_completed: number;
  accuracy_percentage: number;
}

export interface ProgressAnalytics {
  totalExperience: number;
  experienceToNextLevel: number;
  userStats: UserStats;
  skillCategories: SkillCategory[];
  dailyProgress: DailyProgress[];
  weeklyProgress: WeeklyProgress[];
  monthlyProgress: MonthlyProgress[];
  currentLevel: number;
  wordsLearned: number;
  sentencesCompleted: number;
  averageAccuracy: number;
  totalTimeSpent: number;
  learningStreak: LearningStreak;
  achievements: Achievement[];
}

export interface UserStats {
  wordsLearned: number;
  sentencesCompleted: number;
  averageAccuracy: number;
  currentLevel: number;
  totalExperience: number;
  learningStreak: LearningStreak;
  achievements: Achievement[];
}

class ProgressService {
  private getCurrentUserId(): string | null {
    const authStore = useAuthStore();
    return authStore.user?.id || null;
  }

  private calculateExperienceForLevel(level: number): number {
    return Math.floor(100 * Math.pow(1.5, level - 1));
  }

  private calculateWeeklyProgress(dailyProgress: DailyProgress[]): WeeklyProgress[] {
    const weeklyMap = new Map<string, WeeklyProgress>();

    dailyProgress.forEach((day) => {
      const date = new Date(day.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0] || '';

      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          date: weekKey,
          experience_gained: 0,
          vocabulary_studied: 0,
          sentences_completed: 0,
          accuracy_percentage: 0,
        });
      }

      const week = weeklyMap.get(weekKey)!;
      week.experience_gained += day.experience_gained;
      week.vocabulary_studied += day.vocabulary_studied;
      week.sentences_completed += day.sentences_completed;
      week.accuracy_percentage = (week.accuracy_percentage + day.accuracy_percentage) / 2;
    });

    return Array.from(weeklyMap.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }

  private calculateMonthlyProgress(dailyProgress: DailyProgress[]): MonthlyProgress[] {
    const monthlyMap = new Map<string, MonthlyProgress>();

    dailyProgress.forEach((day) => {
      const date = new Date(day.date);
      const monthKey = date.toISOString().slice(0, 7) || '';

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          date: monthKey,
          experience_gained: 0,
          vocabulary_studied: 0,
          sentences_completed: 0,
          accuracy_percentage: 0,
        });
      }

      const month = monthlyMap.get(monthKey)!;
      month.experience_gained += day.experience_gained;
      month.vocabulary_studied += day.vocabulary_studied;
      month.sentences_completed += day.sentences_completed;
      month.accuracy_percentage = (month.accuracy_percentage + day.accuracy_percentage) / 2;
    });

    return Array.from(monthlyMap.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }

  private calculateTotalTimeSpent(dailyProgress: DailyProgress[]): number {
    return dailyProgress.reduce((total, day) => total + day.time_spent_minutes, 0);
  }

  private async getUserStats(): Promise<UserStats> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return {
        wordsLearned: 0,
        sentencesCompleted: 0,
        averageAccuracy: 0,
        currentLevel: 1,
        totalExperience: 0,
        learningStreak: {
          current_streak: 0,
          longest_streak: 0,
          start_date: new Date().toISOString(),
          is_active: false,
        },
        achievements: [],
      };
    }

    const { data: userProgress } = await supabase
      .from('user_progress')
      .select('total_experience, words_learned, sentences_completed, average_accuracy')
      .eq('user_id', userId)
      .single();

    const { data: streakData } = await supabase
      .from('learning_streaks')
      .select('current_streak, longest_streak, start_date, is_active')
      .eq('user_id', userId)
      .single();

    const { data: achievements } = await supabase
      .from('user_achievements')
      .select(
        `
        achievement_id,
        earned_at,
        achievements!inner(*)
      `,
      )
      .eq('user_id', userId);

    const userAchievements: Achievement[] = [];
    if (achievements) {
      for (const a of achievements) {
        const ach = a.achievements as unknown as Record<string, unknown>;
        userAchievements.push({
          id: (ach.id as string) ?? '',
          name: (ach.name as string) ?? '',
          description: (ach.description as string) ?? '',
          icon: (ach.icon as string) ?? '',
          category: (ach.category as string) ?? '',
          requirement_type: (ach.requirement_type as string) ?? '',
          requirement_value: (ach.requirement_value as number) ?? 0,
          experience_reward: (ach.experience_reward as number) ?? 0,
          earned_at: a.earned_at,
        });
      }
    }

    const totalExperience = userProgress?.total_experience || 0;
    let currentLevel = 1;
    let experienceNeeded = 100;
    let accumulatedExperience = 0;

    while (accumulatedExperience + experienceNeeded <= totalExperience) {
      accumulatedExperience += experienceNeeded;
      currentLevel++;
      experienceNeeded = this.calculateExperienceForLevel(currentLevel);
    }

    return {
      wordsLearned: userProgress?.words_learned || 0,
      sentencesCompleted: userProgress?.sentences_completed || 0,
      averageAccuracy: userProgress?.average_accuracy || 0,
      currentLevel,
      totalExperience,
      learningStreak: streakData || {
        current_streak: 0,
        longest_streak: 0,
        start_date: new Date().toISOString(),
        is_active: false,
      },
      achievements: userAchievements,
    };
  }

  private async addExperience(amount: number): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const { data: currentProgress } = await supabase
      .from('user_progress')
      .select('total_experience')
      .eq('user_id', userId)
      .single();

    const newTotalExperience = (currentProgress?.total_experience || 0) + amount;

    await supabase
      .from('user_progress')
      .update({ total_experience: newTotalExperience })
      .eq('user_id', userId);

    await this.checkAndAwardAchievements();
  }

  async checkAndAwardAchievements(): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const { data: allAchievements } = await supabase.from('achievements').select('*');

    if (!allAchievements) return;

    const { data: userAchievements } = await supabase
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', userId);

    const earnedAchievementIds = userAchievements?.map((ua) => ua.achievement_id) || [];
    const userStats = await this.getUserStats();

    for (const achievement of allAchievements) {
      if (earnedAchievementIds.includes(achievement.id)) continue;

      let shouldAward = false;

      switch (achievement.requirement_type) {
        case 'total_experience':
          shouldAward = userStats.totalExperience >= achievement.requirement_value;
          break;
        case 'words_learned':
          shouldAward = userStats.wordsLearned >= achievement.requirement_value;
          break;
        case 'sentences_completed':
          shouldAward = userStats.sentencesCompleted >= achievement.requirement_value;
          break;
        case 'current_streak':
          shouldAward = userStats.learningStreak.current_streak >= achievement.requirement_value;
          break;
        case 'longest_streak':
          shouldAward = userStats.learningStreak.longest_streak >= achievement.requirement_value;
          break;
      }

      if (shouldAward) {
        await supabase.from('user_achievements').insert({
          user_id: userId,
          achievement_id: achievement.id,
          earned_at: new Date().toISOString(),
        });

        await this.addExperience(achievement.experience_reward);
      }
    }
  }

  async updateDailyProgress(
    vocabularyStudied = 0,
    sentencesCompleted = 0,
    timeSpentMinutes = 0,
    experienceGained = 0,
    gamesPlayed = 0,
    accuracyPercentage = 0,
  ): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const { data: existingProgress } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('date', new Date().toISOString().split('T')[0])
      .single();

    if (existingProgress) {
      await supabase
        .from('daily_progress')
        .update({
          vocabulary_studied: existingProgress.vocabulary_studied + vocabularyStudied,
          sentences_completed: existingProgress.sentences_completed + sentencesCompleted,
          time_spent_minutes: existingProgress.time_spent_minutes + timeSpentMinutes,
          experience_gained: existingProgress.experience_gained + experienceGained,
          games_played: existingProgress.games_played + gamesPlayed,
          accuracy_percentage: Math.round(
            (existingProgress.accuracy_percentage + accuracyPercentage) / 2,
          ),
        })
        .eq('user_id', userId)
        .eq('date', new Date().toISOString().split('T')[0]);
    } else {
      await supabase.from('daily_progress').insert({
        user_id: userId,
        date: new Date().toISOString().split('T')[0],
        vocabulary_studied: vocabularyStudied,
        sentences_completed: sentencesCompleted,
        time_spent_minutes: timeSpentMinutes,
        experience_gained: experienceGained,
        games_played: gamesPlayed,
        accuracy_percentage: accuracyPercentage,
      });
    }

    await this.addExperience(experienceGained);
  }

  async updateLearningStreak(): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: yesterdayProgress } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('date', yesterdayStr)
      .single();

    const { data: streakData } = await supabase
      .from('learning_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (streakData) {
      let newStreak = streakData.current_streak;
      let newLongest = streakData.longest_streak;

      if (yesterdayProgress) {
        newStreak += 1;
        newLongest = Math.max(newLongest, newStreak);
      } else if (!yesterdayProgress) {
        newStreak = 1;
      }

      await supabase
        .from('learning_streaks')
        .update({
          current_streak: newStreak,
          longest_streak: newLongest,
          is_active: true,
        })
        .eq('user_id', userId);
    } else {
      await supabase.from('learning_streaks').insert({
        user_id: userId,
        current_streak: 1,
        longest_streak: 1,
        start_date: new Date().toISOString(),
        is_active: true,
      });
    }
  }

  async updateSkillProgress(skillCategoryName: string, experienceGained: number): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const { data: skillCategory } = await supabase
      .from('skill_categories')
      .select('*')
      .eq('name', skillCategoryName)
      .single();

    if (!skillCategory) return;

    const { data: existingSkill } = await supabase
      .from('user_skills')
      .select('*')
      .eq('user_id', userId)
      .eq('skill_category_id', skillCategory.id)
      .single();

    if (existingSkill) {
      const newExperience = existingSkill.experience + experienceGained;
      let newLevel = existingSkill.level;
      let experienceToNext = this.calculateExperienceForLevel(newLevel);

      while (newExperience >= experienceToNext) {
        newLevel++;
        experienceToNext = this.calculateExperienceForLevel(newLevel);
      }

      await supabase
        .from('user_skills')
        .update({
          experience: newExperience,
          level: newLevel,
          experience_to_next_level:
            experienceToNext - (newExperience - this.calculateExperienceForLevel(newLevel - 1)),
        })
        .eq('user_id', userId)
        .eq('skill_category_id', skillCategory.id);
    } else {
      await supabase.from('user_skills').insert({
        user_id: userId,
        skill_category_id: skillCategory.id,
        experience: experienceGained,
        level: 1,
        experience_to_next_level: 100,
      });
    }

    await this.addExperience(experienceGained);
  }

  async getProgressAnalytics(): Promise<ProgressAnalytics> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return {
        totalExperience: 0,
        experienceToNextLevel: 100,
        userStats: {
          wordsLearned: 0,
          sentencesCompleted: 0,
          averageAccuracy: 0,
          currentLevel: 1,
          totalExperience: 0,
          learningStreak: {
            current_streak: 0,
            longest_streak: 0,
            start_date: new Date().toISOString(),
            is_active: false,
          },
          achievements: [],
        },
        skillCategories: [],
        dailyProgress: [],
        weeklyProgress: [],
        monthlyProgress: [],
        currentLevel: 1,
        wordsLearned: 0,
        sentencesCompleted: 0,
        averageAccuracy: 0,
        totalTimeSpent: 0,
        learningStreak: {
          current_streak: 0,
          longest_streak: 0,
          start_date: new Date().toISOString(),
          is_active: false,
        },
        achievements: [],
      };
    }

    const userStats = await this.getUserStats();

    const { data: dailyProgress } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(30);

    const { data: userSkills } = await supabase
      .from('user_skills')
      .select('*, skill_categories(*)')
      .eq('user_id', userId);

    const skillCategories =
      userSkills?.map((skill) => ({
        id: skill.skill_categories.id,
        name: skill.skill_categories.name,
        description: skill.skill_categories.description,
        icon: skill.skill_categories.icon,
        color: skill.skill_categories.color,
        level: skill.level,
        experience: skill.experience,
        experience_to_next_level: skill.experience_to_next_level,
      })) || [];

    const weeklyProgress = this.calculateWeeklyProgress(dailyProgress || []);
    const monthlyProgress = this.calculateMonthlyProgress(dailyProgress || []);
    const totalTimeSpent = this.calculateTotalTimeSpent(dailyProgress || []);

    const currentLevel = userStats.currentLevel;
    const experienceForNextLevel = this.calculateExperienceForLevel(currentLevel + 1);
    const experienceInCurrentLevel =
      userStats.totalExperience -
      Array.from({ length: currentLevel - 1 }, (_, i) =>
        this.calculateExperienceForLevel(i + 1),
      ).reduce((sum, exp) => sum + exp, 0);
    const experienceToNextLevel = experienceForNextLevel - experienceInCurrentLevel;

    return {
      totalExperience: userStats.totalExperience,
      experienceToNextLevel,
      userStats,
      skillCategories,
      dailyProgress: dailyProgress || [],
      weeklyProgress,
      monthlyProgress,
      currentLevel,
      wordsLearned: userStats.wordsLearned,
      sentencesCompleted: userStats.sentencesCompleted,
      averageAccuracy: userStats.averageAccuracy,
      totalTimeSpent,
      learningStreak: userStats.learningStreak,
      achievements: userStats.achievements,
    };
  }

  async recordGameSession(
    gameType: string,
    score: number,
    durationSeconds: number,
    questionsAnswered: number,
    correctAnswers: number,
    experienceGained: number,
  ): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    await supabase.from('game_sessions').insert({
      user_id: userId,
      game_type: gameType,
      score,
      duration_seconds: durationSeconds,
      questions_answered: questionsAnswered,
      correct_answers: correctAnswers,
      experience_gained: experienceGained,
      played_at: new Date().toISOString(),
    });

    await this.updateDailyProgress(
      gameType === 'vocabulary' ? questionsAnswered : 0,
      gameType === 'sentence' ? questionsAnswered : 0,
      Math.round(durationSeconds / 60),
      experienceGained,
      1,
      Math.round((correctAnswers / questionsAnswered) * 100),
    );

    await this.updateLearningStreak();
    await this.addExperience(experienceGained);
  }
}

export const progressService = new ProgressService();
