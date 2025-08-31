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

    // Total experience from profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('total_experience')
      .eq('id', userId)
      .maybeSingle();

    // Words learned = count of vocabulary with mastery_level >= 1
    const { count: wordsLearnedCount } = await supabase
      .from('user_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('mastery_level', 1);

    // Sentence games completed = count of sessions of type 'sentence'
    const { count: sentenceGameCount } = await supabase
      .from('game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('game_type', 'sentence');

    // Average accuracy across all game sessions
    const { data: sessions } = await supabase
      .from('game_sessions')
      .select('correct_answers, questions_answered')
      .eq('user_id', userId);

    let totalCorrect = 0;
    let totalQuestions = 0;
    if (sessions) {
      for (const s of sessions) {
        totalCorrect += s.correct_answers || 0;
        totalQuestions += s.questions_answered || 0;
      }
    }
    const avgAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

    const { data: streakData } = await supabase
      .from('learning_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

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

    const totalExperience = profile?.total_experience || 0;
    let currentLevel = 1;
    let experienceNeeded = 100;
    let accumulatedExperience = 0;

    while (accumulatedExperience + experienceNeeded <= totalExperience) {
      accumulatedExperience += experienceNeeded;
      currentLevel++;
      experienceNeeded = this.calculateExperienceForLevel(currentLevel);
    }

    return {
      wordsLearned: wordsLearnedCount || 0,
      sentencesCompleted: sentenceGameCount || 0,
      averageAccuracy: avgAccuracy,
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('total_experience')
      .eq('id', userId)
      .maybeSingle();

    const newTotalExperience = (profile?.total_experience || 0) + amount;

    await supabase
      .from('profiles')
      .update({ total_experience: newTotalExperience })
      .eq('id', userId);

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

    // Precompute metrics for achievement checks
    const { count: wordsLearnedCount } = await supabase
      .from('user_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('mastery_level', 1);

    const { count: sentenceGameCount } = await supabase
      .from('game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('game_type', 'sentence');

    const { data: lastSessions } = await supabase
      .from('game_sessions')
      .select('game_type, correct_answers, questions_answered, completed_at')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(1);
    const lastSession = lastSessions && lastSessions.length > 0 ? lastSessions[0] : null;

    for (const achievement of allAchievements) {
      if (earnedAchievementIds.includes(achievement.id)) continue;

      let shouldAward = false;

      switch (achievement.requirement_type) {
        case 'count':
          if (achievement.category === 'vocabulary') {
            shouldAward = (wordsLearnedCount || 0) >= achievement.requirement_value;
          } else if (achievement.category === 'grammar') {
            shouldAward = (sentenceGameCount || 0) >= achievement.requirement_value;
          }
          break;
        case 'streak':
          shouldAward = userStats.learningStreak.current_streak >= achievement.requirement_value;
          break;
        case 'accuracy': {
          if (lastSession) {
            const lastAccuracy =
              lastSession.questions_answered > 0
                ? Math.round((lastSession.correct_answers / lastSession.questions_answered) * 100)
                : 0;
            if (achievement.category === 'vocabulary') {
              shouldAward =
                lastSession.game_type === 'vocabulary' &&
                lastAccuracy >= achievement.requirement_value;
            } else {
              shouldAward = lastAccuracy >= achievement.requirement_value;
            }
          }
          break;
        }
        case 'level':
          shouldAward = userStats.currentLevel >= achievement.requirement_value;
          break;
        default:
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

    try {
      const { data: existingProgress } = await supabase
        .from('daily_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('date', new Date().toISOString().split('T')[0])
        .maybeSingle();

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
    } catch (e) {
      console.warn('daily_progress update skipped (table may be missing):', e);
    }
  }

  async updateLearningStreak(): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    try {
      const { data: yesterdayProgress } = await supabase
        .from('daily_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('date', yesterdayStr)
        .maybeSingle();

      const { data: streakData } = await supabase
        .from('learning_streaks')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

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
          })
          .eq('user_id', userId);
      } else {
        await supabase.from('learning_streaks').insert({
          user_id: userId,
          current_streak: 1,
          longest_streak: 1,
        });
      }
    } catch (e) {
      console.warn('learning_streaks update skipped (table may be missing):', e);
    }
  }

  async updateSkillProgress(skillCategoryName: string, experienceGained: number): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const { data: skillCategory } = await supabase
      .from('skill_categories')
      .select('*')
      .eq('name', skillCategoryName)
      .maybeSingle();

    if (!skillCategory) return;

    const { data: existingSkill } = await supabase
      .from('user_skill_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('skill_category_id', skillCategory.id)
      .maybeSingle();

    if (existingSkill) {
      const newExperience = existingSkill.experience + experienceGained;
      let newLevel = existingSkill.level;
      let experienceToNext = this.calculateExperienceForLevel(newLevel);

      while (newExperience >= experienceToNext) {
        newLevel++;
        experienceToNext = this.calculateExperienceForLevel(newLevel);
      }

      await supabase
        .from('user_skill_progress')
        .update({
          experience: newExperience,
          level: newLevel,
          experience_to_next_level:
            experienceToNext - (newExperience - this.calculateExperienceForLevel(newLevel - 1)),
        })
        .eq('user_id', userId)
        .eq('skill_category_id', skillCategory.id);
    } else {
      await supabase.from('user_skill_progress').insert({
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
      .from('user_skill_progress')
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
    });

    await this.updateDailyProgress(
      gameType === 'vocabulary' ? questionsAnswered : 0,
      gameType === 'sentence' ? questionsAnswered : 0,
      Math.round(durationSeconds / 60),
      experienceGained,
      1,
      questionsAnswered > 0 ? Math.round((correctAnswers / questionsAnswered) * 100) : 0,
    );

    await this.updateLearningStreak();
    await this.addExperience(experienceGained);
  }
}

export const progressService = new ProgressService();
