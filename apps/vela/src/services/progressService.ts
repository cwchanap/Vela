import { useAuthStore } from 'src/stores/auth';
import { getApiUrl } from 'src/utils/api';

async function httpJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  return res.json();
}

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

    try {
      const analytics = await httpJson(getApiUrl(`progress/analytics?user_id=${userId}`));
      return analytics;
    } catch (error) {
      console.error('Error fetching progress analytics:', error);
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

    try {
      await httpJson(getApiUrl('progress/game-session'), {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          game_type: gameType,
          score,
          duration_seconds: durationSeconds,
          questions_answered: questionsAnswered,
          correct_answers: correctAnswers,
          experience_gained: experienceGained,
        }),
      });
    } catch (error) {
      console.error('Error recording game session:', error);
    }
  }
}

export const progressService = new ProgressService();
