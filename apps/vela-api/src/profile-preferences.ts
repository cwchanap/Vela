import { z } from 'zod';
import {
  LLM_EFFORT_LEVELS,
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  MAX_LLM_THINKING_OVERRIDES,
  type LlmEffort,
  type LlmPreferences,
  type LlmProvider,
} from '@vela/common/contracts/llm';

const DEFAULT_DAILY_LESSON_GOAL = 5;
const DEFAULT_LESSON_DURATION_MINUTES = 6;
const DEFAULT_DAILY_GOAL = 30;

const LlmEffortSchema = z.enum(LLM_EFFORT_LEVELS);
const LlmKeySchema = z.string().min(1).max(4096);
const LlmModelSchema = z.string().min(1).max(512);
const MAX_THINKING_OVERRIDES = MAX_LLM_THINKING_OVERRIDES;

const LlmPreferencesSchema = z.object({
  keys: z.partialRecord(z.enum(LLM_PROVIDERS), LlmKeySchema),
  thinking: z
    .record(LlmModelSchema, LlmEffortSchema)
    .refine((entries) => Object.keys(entries).length <= MAX_THINKING_OVERRIDES),
  defaultModel: z.object({
    provider: z.enum(LLM_PROVIDERS),
    model: LlmModelSchema,
  }),
}) satisfies z.ZodType<LlmPreferences>;

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKnownProvider = (val: unknown): val is LlmProvider =>
  typeof val === 'string' && (LLM_PROVIDERS as readonly string[]).includes(val);

const isEffortLevel = (val: unknown): val is LlmEffort =>
  typeof val === 'string' && (LLM_EFFORT_LEVELS as readonly string[]).includes(val);

// Lenient on reads: one malformed provider key or thinking entry should never drop the
// entire llm preferences map and cause saved keys to be lost on the next save.
const LlmPreferencesReadSchema = z.preprocess((val) => {
  if (!isPlainObject(val)) return undefined;

  const rawKeys = isPlainObject(val.keys) ? val.keys : {};
  const cleanedKeys: Partial<Record<LlmProvider, string>> = {};
  for (const [k, v] of Object.entries(rawKeys)) {
    if (isKnownProvider(k) && LlmKeySchema.safeParse(v).success) {
      cleanedKeys[k] = v as string;
    } else {
      console.warn('Ignoring invalid llm.keys entry');
    }
  }

  const rawThinking = isPlainObject(val.thinking) ? val.thinking : {};
  const cleanedThinking: Record<string, LlmEffort> = {};
  for (const [k, v] of Object.entries(rawThinking)) {
    if (
      LlmModelSchema.safeParse(k).success &&
      isEffortLevel(v) &&
      Object.keys(cleanedThinking).length < MAX_THINKING_OVERRIDES
    ) {
      cleanedThinking[k] = v;
    } else {
      console.warn('Ignoring invalid llm.thinking entry');
    }
  }

  if (!isPlainObject(val.defaultModel) || !isKnownProvider(val.defaultModel.provider)) {
    console.warn('Ignoring llm with invalid defaultModel.provider');
    return undefined;
  }
  const provider = val.defaultModel.provider;
  const validModel = LlmModelSchema.safeParse(val.defaultModel.model);
  if (!validModel.success) console.warn('Replacing invalid llm.defaultModel.model');
  const cleanedDefaultModel = {
    provider,
    model: validModel.success ? validModel.data : LLM_PROVIDER_REGISTRY[provider].defaultModel,
  };

  return {
    keys: cleanedKeys,
    thinking: cleanedThinking,
    defaultModel: cleanedDefaultModel,
  };
}, LlmPreferencesSchema.optional().catch(undefined));

export const preserveStoredLlm = (next: Record<string, unknown>, stored: unknown) => {
  if (!isPlainObject(stored) || !('llm' in stored)) return;
  const raw = stored.llm;
  if (next.llm === undefined) {
    next.llm = raw;
    return;
  }
  if (!isPlainObject(raw) || LlmPreferencesReadSchema.parse(raw) !== undefined) return;
  const replacement = LlmPreferencesSchema.parse(next.llm);
  const recovered = LlmPreferencesReadSchema.parse({
    ...raw,
    defaultModel: replacement.defaultModel,
  });
  if (!recovered) return;
  const thinking = { ...replacement.thinking };
  for (const [model, effort] of Object.entries(recovered.thinking)) {
    if (Object.keys(thinking).length >= MAX_THINKING_OVERRIDES) break;
    if (!Object.hasOwn(thinking, model)) thinking[model] = effort;
  }
  next.llm = { ...replacement, keys: { ...recovered.keys, ...replacement.keys }, thinking };
};

const PreferencesShape = {
  dailyGoal: z.coerce.number().int().min(1).max(1440).optional(),
  dailyLessonGoal: z.coerce.number().int().min(1).max(50).optional(),
  lessonDurationMinutes: z.coerce.number().int().min(1).max(120).optional(),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  notifications: z.boolean().optional(),
  todayStudyTime: z.coerce.number().optional(),
  darkMode: z.boolean().optional(),
  llm: LlmPreferencesSchema.optional(),
} satisfies z.ZodRawShape;

// Strip unknown keys on writes (PUT) to prevent arbitrary/unexpected keys being stored
// while still accepting legacy data with extra fields.
export const PreferencesSchema = z.object(PreferencesShape).strip();

// Lenient on reads (GET) to prevent legacy keys in DynamoDB from causing 500s.
// This strips unknown keys while still validating known keys.
export const PreferencesReadSchema = z
  .object({
    ...PreferencesShape,
    darkMode: z.boolean().optional().catch(undefined),
    llm: LlmPreferencesReadSchema,
  })
  .strip();

/**
 * Validates and normalizes a numeric preference value.
 * Ensures the value is a finite number within the specified range [min, max].
 * If invalid or out of range, returns the fallback value.
 */
const normalizeRequiredPreferenceNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  fieldName: string,
) => {
  const parsedValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsedValue)) {
    console.warn(`Invalid ${fieldName}: ${value}. Using fallback: ${fallback}`);
    return fallback;
  }
  const normalized = Math.trunc(parsedValue);
  if (normalized < min || normalized > max) {
    console.warn(`Out of range ${fieldName}: ${normalized}. Using fallback: ${fallback}`);
    return fallback;
  }
  return normalized;
};

export const normalizePreferences = (preferences: unknown) => {
  const base = isPlainObject(preferences) ? preferences : {};
  return {
    ...base,
    dailyGoal: normalizeRequiredPreferenceNumber(
      base.dailyGoal,
      DEFAULT_DAILY_GOAL,
      1,
      1440,
      'dailyGoal',
    ),
    dailyLessonGoal: normalizeRequiredPreferenceNumber(
      base.dailyLessonGoal,
      DEFAULT_DAILY_LESSON_GOAL,
      1,
      50,
      'dailyLessonGoal',
    ),
    lessonDurationMinutes: normalizeRequiredPreferenceNumber(
      base.lessonDurationMinutes,
      DEFAULT_LESSON_DURATION_MINUTES,
      1,
      120,
      'lessonDurationMinutes',
    ),
    todayStudyTime: normalizeRequiredPreferenceNumber(
      base.todayStudyTime,
      0,
      0,
      1440, // Max minutes in a day
      'todayStudyTime',
    ),
  };
};
