import { z } from 'zod';
import {
  LLM_EFFORT_LEVELS,
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  MAX_LLM_THINKING_OVERRIDES,
  PREFERENCES_READ_CONTRACT,
  type LlmEffort,
  type LlmPreferences,
  type LlmProvider,
} from '@vela/common/contracts/llm';

export { PREFERENCES_READ_CONTRACT };

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
    console.warn('Replacing invalid llm.defaultModel with the Google default');
    return {
      keys: cleanedKeys,
      thinking: cleanedThinking,
      defaultModel: { provider: 'google', model: LLM_PROVIDER_REGISTRY.google.defaultModel },
    };
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

// Writes that omit llm keep the raw stored subtree; an explicit llm replacement is
// authoritative, so deleted keys and overrides stay deleted.
export const preserveStoredLlm = (next: Record<string, unknown>, stored: unknown) => {
  if (!isPlainObject(stored) || !('llm' in stored)) return;
  if (next.llm === undefined) next.llm = stored.llm;
};

const isSameJsonValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => isSameJsonValue(item, b[index]))
    );
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(bRecord, key) && isSameJsonValue(aRecord[key], bRecord[key]))
  );
};

// Returns true when stored llm.keys contains a valid key for a provider this
// build does not recognize (e.g. after a rollback across a provider change),
// meaning the GET view dropped that key and is not complete.
export const hasUnrecognizedLlmKey = (preferences: unknown): boolean => {
  if (!isPlainObject(preferences) || !isPlainObject(preferences.llm)) return false;
  const rawKeys = preferences.llm.keys;
  if (!isPlainObject(rawKeys)) return false;
  return Object.entries(rawKeys).some(
    ([provider, key]) => !isKnownProvider(provider) && typeof key === 'string' && key.length > 0,
  );
};

// Returns true when a markerless PUT's `llm` matches what GET would return for
// the stored profile's `llm` subtree (old tabs send their full cached preferences
// on unrelated saves such as darkMode or dailyGoal).
export const llmMatchesReadSnapshot = (sentLlm: unknown, storedPreferences: unknown): boolean => {
  const rawStoredLlm = isPlainObject(storedPreferences) ? storedPreferences.llm : undefined;
  const parsed = LlmPreferencesReadSchema.safeParse(rawStoredLlm);
  const readLlm = parsed.success ? parsed.data : undefined;
  if (sentLlm === undefined) return readLlm === undefined;
  if (readLlm === undefined) return false;
  return isSameJsonValue(sentLlm, readLlm);
};

// Sanitizes raw preferences for a read/response and reports whether the
// resulting LLM view is complete (no unrecognized provider keys were dropped).
export const sanitizePreferencesForRead = (rawPreferences: unknown) => {
  const parsed = PreferencesReadSchema.safeParse(normalizePreferences(rawPreferences));
  if (!parsed.success) return null;
  return {
    preferences: parsed.data,
    isCompleteLlmSnapshot: !hasUnrecognizedLlmKey(rawPreferences),
  };
};

// Optimistic-lock token carried on preference writes. Kept here so the route
// schema and the e2e mock apply the identical validation rule.
export const ExpectedPreferencesVersionSchema = z.string().uuid().nullable().optional();

// Explicit llm replacement marker. An absent (undefined) marker indicates an
// older client or unverified snapshot (rejected with 428 when llm changes);
// null or any other non-matching value is rejected with 400. Kept here so the
// route and the e2e mock validate identically.
export const LlmWriteContractSchema = z.literal(PREFERENCES_READ_CONTRACT).optional();

export const replacesLlm = (preferences: unknown): boolean =>
  isPlainObject(preferences) && Object.hasOwn(preferences, 'llm');

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
  let parsedValue: number;
  try {
    parsedValue = typeof value === 'number' ? value : Number(value);
  } catch {
    // Exotic stored values (e.g. an object with a non-callable toString) make
    // Number() throw — treat them like any other invalid value.
    parsedValue = Number.NaN;
  }
  if (!Number.isFinite(parsedValue)) {
    console.warn(`Invalid ${fieldName}: using fallback ${fallback}`, value);
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
