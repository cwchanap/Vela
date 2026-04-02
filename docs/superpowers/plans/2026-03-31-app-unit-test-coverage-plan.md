# App Unit Test Coverage Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a green `apps/vela` unit-test baseline and raise app line coverage by about 10 percentage points through high-value frontend unit tests.

**Architecture:** Start by stabilizing the current failing config test so coverage work has a trustworthy baseline. Then add targeted tests for the untested listening setup and boot wiring, followed by smaller coverage wins such as `NavigationLink` and store exports, checking coverage after each batch so optional work only happens if needed.

**Tech Stack:** Bun, Vitest, Vue Test Utils, Quasar, Pinia, TanStack Vue Query

---

## File Structure

- Modify: `apps/vela/src/config/index.test.ts` — align config assertions with the real env-backed test environment or isolate fallback cases.
- Create: `apps/vela/src/components/games/listening/ListeningSetup.test.ts` — add focused unit coverage for TTS state handling and emitted config.
- Create: `apps/vela/src/boot/main.test.ts` — verify theme initialization and auth-driven theme sync wiring.
- Create: `apps/vela/src/boot/query.test.ts` — verify Vue Query boot plugin registration and exported shared instances/constants.
- Create: `apps/vela/src/components/NavigationLink.test.ts` — verify enabled/disabled rendering and click behavior.
- Create: `apps/vela/src/stores/index.test.ts` — verify Pinia factory export and expected store exports.
- Optional Create: `apps/vela/src/composables/queries/index.test.ts` — low-risk barrel-export coverage if the primary pass is short of the target.
- Optional Create: `apps/vela/src/components/EssentialLink.test.ts` — low-risk component coverage if the primary pass is short of the target.

### Task 1: Stabilize the app unit-test baseline

**Files:**

- Modify: `apps/vela/src/config/index.test.ts`
- Check: `apps/vela/src/config/index.ts`

- [ ] **Step 1: Write the failing test expectations around the current config behavior**

```ts
it('uses the env-backed API URL in the test environment', async () => {
  const { config } = await import('./index');
  expect(config.api.url).toBe('http://localhost:9005/api/');
});

it('uses the env-backed app name in the test environment', async () => {
  const { config } = await import('./index');
  expect(config.app.name).toBe('Vela');
});
```

- [ ] **Step 2: Run the config test to verify the current baseline failure**

Run: `cd apps/vela && bun vitest run src/config/index.test.ts`

Expected: FAIL on the old fallback expectations for `/api/` and `Japanese Learning App`.

- [ ] **Step 3: Update `src/config/index.test.ts` with minimal, correct assertions**

```ts
it('uses configured values when env vars are present', async () => {
  const { config } = await import('./index');
  expect(config.api.url).toBe('http://localhost:9005/api/');
  expect(config.app.name).toBe('Vela');
  expect(config.app.version).toBe('0.0.1');
});
```

If fallback behavior still needs coverage, isolate it behind a controlled stubbed import rather than assuming no env vars are present in this repo.

- [ ] **Step 4: Run the config test again**

Run: `cd apps/vela && bun vitest run src/config/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full app unit suite to restore a green baseline**

Run: `cd apps/vela && bun vitest run`

Expected: PASS for all current app unit tests.

- [ ] **Step 6: Record the baseline coverage percentage after the suite is green**

Run: `cd apps/vela && bun vitest run --coverage`

Expected: PASS. Record the current line-coverage percentage in the implementation notes or handoff notes. This becomes the baseline used to decide whether the optional top-up task is needed and whether the final result reached the `+10` percentage-point target.

- [ ] **Step 7: Commit**

```bash
git add apps/vela/src/config/index.test.ts
git commit -m "test: stabilize app config baseline"
```

### Task 2: Add listening setup coverage

**Files:**

- Create: `apps/vela/src/components/games/listening/ListeningSetup.test.ts`
- Test subject: `apps/vela/src/components/games/listening/ListeningSetup.vue`
- Check: `apps/vela/src/components/games/JlptLevelSelector.vue`
- Check: `apps/vela/src/pages/games/ListeningGame.test.ts`

- [ ] **Step 1: Write the first failing test for the loading and ready states**

```ts
it('shows a loading state before TTS settings resolve', async () => {
  const deferred = createDeferred<{ hasApiKey: boolean }>();
  mockGetTTSSettings.mockReturnValueOnce(deferred.promise);

  const wrapper = mountComponent();

  expect(wrapper.text()).toContain('Listening Practice');
  expect(wrapper.findComponent({ name: 'QSpinnerDots' }).exists()).toBe(true);

  deferred.resolve({ hasApiKey: true });
  await flushPromises();

  expect(wrapper.find('button').text()).toContain('Start Listening');
});
```

- [ ] **Step 2: Run the new listening setup test file**

Run: `cd apps/vela && bun vitest run src/components/games/listening/ListeningSetup.test.ts`

Expected: FAIL because the new test file does not exist yet.

- [ ] **Step 3: Add the test file with shared mount helpers and service mocks**

```ts
vi.mock('src/services/ttsService', () => ({
  getTTSSettings: mockGetTTSSettings,
}));

const mountComponent = (props = {}) =>
  mount(ListeningSetup, {
    props: { isStarting: false, ...props },
    global: { plugins: [Quasar] },
  });
```

- [ ] **Step 4: Add tests for TTS status branches**

Cover:

- `loading`
- `ready`
- `missing`
- `error`
- retry from `error`

```ts
it('shows the missing configuration banner when no API key is available', async () => {
  mockGetTTSSettings.mockResolvedValueOnce({ hasApiKey: false });
  const wrapper = mountComponent();
  await flushPromises();
  expect(wrapper.text()).toContain('Text-to-speech is required for this game');
});
```

- [ ] **Step 5: Add tests for emitted start config**

Cover:

- default emitted config
- switching question mode
- switching audio source
- JLPT selection wiring
- start-button loading via `isStarting`

```ts
it('emits the selected listening config on start', async () => {
  mockGetTTSSettings.mockResolvedValueOnce({ hasApiKey: true });
  const wrapper = mountComponent();
  await flushPromises();

  await wrapper.find('[data-testid="jlpt-level-5"]').trigger('click');
  await wrapper.find('button').trigger('click');

  expect(wrapper.emitted('start')?.[0]?.[0]).toEqual({
    mode: 'multiple-choice',
    source: 'vocabulary',
    jlptLevels: [5],
  });
});
```

- [ ] **Step 6: Run the listening setup tests**

Run: `cd apps/vela && bun vitest run src/components/games/listening/ListeningSetup.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full app suite to make sure the new component tests integrate cleanly**

Run: `cd apps/vela && bun vitest run`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela/src/components/games/listening/ListeningSetup.test.ts
git commit -m "test: cover listening setup states"
```

### Task 3: Add boot-file coverage

**Files:**

- Create: `apps/vela/src/boot/main.test.ts`
- Create: `apps/vela/src/boot/query.test.ts`
- Test subjects: `apps/vela/src/boot/main.ts`, `apps/vela/src/boot/query.ts`
- Check: `apps/vela/src/stores/theme.ts`
- Check: `apps/vela/src/stores/auth.ts`
- Check: `packages/common/src/config.ts`

- [ ] **Step 1: Write failing tests for `boot/main.ts` behavior**

```ts
it('initializes the theme store during boot', async () => {
  const bootMain = (await import('./main')).default;
  await bootMain({ store: {} as never });
  expect(mockThemeStore.initialize).toHaveBeenCalledTimes(1);
});

it('syncs theme when auth preferences include darkMode', async () => {
  const bootMain = (await import('./main')).default;
  await bootMain({ store: {} as never });

  const subscribe = mockAuthStore.$subscribe.mock.calls[0][0];
  subscribe({}, { user: { preferences: { darkMode: true } } });

  expect(mockThemeStore.syncWithUserPreferences).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run the `boot/main.ts` test file**

Run: `cd apps/vela && bun vitest run src/boot/main.test.ts`

Expected: FAIL because the test file does not exist yet.

- [ ] **Step 3: Implement `main.test.ts` with targeted store mocks**

```ts
vi.mock('src/stores/theme', () => ({
  useThemeStore: () => mockThemeStore,
}));

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));
```

Also add a test that confirms no sync happens when `darkMode` is `undefined`.

- [ ] **Step 4: Write failing tests for `boot/query.ts`**

```ts
it('installs Vue Query with the shared query client', async () => {
  const app = { use: vi.fn() };
  const bootQuery = (await import('./query')).default;

  bootQuery({ app } as never);

  expect(app.use).toHaveBeenCalledWith(mockVueQueryPlugin, {
    queryClient: queryModule.queryClient,
  });
});
```

- [ ] **Step 5: Run the `boot/query.ts` test file**

Run: `cd apps/vela && bun vitest run src/boot/query.test.ts`

Expected: FAIL because the test file does not exist yet.

- [ ] **Step 6: Implement `query.test.ts` with module mocks**

```ts
vi.mock('quasar/wrappers', () => ({
  boot: (callback: unknown) => callback,
}));

vi.mock('@tanstack/vue-query', () => ({
  VueQueryPlugin: mockVueQueryPlugin,
}));

vi.mock('@vela/common', () => ({
  createQueryClient: mockCreateQueryClient,
  QUERY_STALE_TIME: 300000,
  QUERY_GC_TIME: 600000,
}));
```

Also assert the exported constants and the singleton `queryClient`.

- [ ] **Step 7: Run both boot test files**

Run: `cd apps/vela && bun vitest run src/boot/main.test.ts src/boot/query.test.ts`

Expected: PASS.

- [ ] **Step 8: Run the full app suite**

Run: `cd apps/vela && bun vitest run`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/vela/src/boot/main.test.ts apps/vela/src/boot/query.test.ts
git commit -m "test: add boot file coverage"
```

### Task 4: Add coverage for `NavigationLink`

**Files:**

- Create: `apps/vela/src/components/NavigationLink.test.ts`
- Test subject: `apps/vela/src/components/NavigationLink.vue`

- [ ] **Step 1: Write the first failing test for enabled rendering**

```ts
it('renders title and caption for an enabled link', () => {
  const wrapper = mountComponent({
    title: 'Games',
    caption: 'Practice vocabulary',
    icon: 'sports_esports',
    to: '/games',
  });

  expect(wrapper.text()).toContain('Games');
  expect(wrapper.text()).toContain('Practice vocabulary');
});
```

- [ ] **Step 2: Run the new NavigationLink test file**

Run: `cd apps/vela && bun vitest run src/components/NavigationLink.test.ts`

Expected: FAIL because the test file does not exist yet.

- [ ] **Step 3: Implement the test file with a mocked Quasar app context**

```ts
const notify = vi.fn();

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({ notify }),
  };
});
```

- [ ] **Step 4: Add behavior tests**

Cover:

- disabled state class
- “Soon” chip rendering
- disabled click triggers notify and does not emit
- enabled click emits and does not notify

```ts
it('notifies instead of emitting when disabled', async () => {
  const wrapper = mountComponent({ title: 'Chat', icon: 'chat', disabled: true });
  await wrapper.trigger('click');
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'Chat is coming soon!' }));
  expect(wrapper.emitted('click')).toBeUndefined();
});
```

- [ ] **Step 5: Run the NavigationLink tests**

Run: `cd apps/vela && bun vitest run src/components/NavigationLink.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the full app suite**

Run: `cd apps/vela && bun vitest run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vela/src/components/NavigationLink.test.ts
git commit -m "test: cover navigation link states"
```

### Task 5: Add store-index coverage and measure progress

**Files:**

- Create: `apps/vela/src/stores/index.test.ts`
- Test subject: `apps/vela/src/stores/index.ts`
- Check: `apps/vela/src/stores/auth.ts`
- Check: `apps/vela/src/stores/games.ts`
- Check: `apps/vela/src/stores/chat.ts`
- Check: `apps/vela/src/stores/progress.ts`
- Check: `apps/vela/src/stores/llmSettings.ts`

- [ ] **Step 1: Write the first failing test for the default export**

```ts
it('returns a Pinia instance from the default export', async () => {
  const storesModule = await import('./index');
  const pinia = storesModule.default();
  expect(pinia).toBeDefined();
  expect(typeof pinia.install).toBe('function');
});
```

- [ ] **Step 2: Run the store index test file**

Run: `cd apps/vela && bun vitest run src/stores/index.test.ts`

Expected: FAIL because the test file does not exist yet.

- [ ] **Step 3: Implement the store index tests**

```ts
it('re-exports the main store factories', async () => {
  const storesModule = await import('./index');
  expect(typeof storesModule.useAuthStore).toBe('function');
  expect(typeof storesModule.useGameStore).toBe('function');
  expect(typeof storesModule.useChatStore).toBe('function');
  expect(typeof storesModule.useProgressStore).toBe('function');
  expect(typeof storesModule.useLLMSettingsStore).toBe('function');
});
```

- [ ] **Step 4: Run the store index tests**

Run: `cd apps/vela && bun vitest run src/stores/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full app suite**

Run: `cd apps/vela && bun vitest run`

Expected: PASS.

- [ ] **Step 6: Measure coverage after the primary pass**

Run: `cd apps/vela && bun vitest run --coverage`

Expected: PASS with a material line-coverage increase. Record the resulting line-coverage number before deciding whether Task 6 is needed.

- [ ] **Step 7: Commit**

```bash
git add apps/vela/src/stores/index.test.ts
git commit -m "test: cover store index exports"
```

### Task 6: Optional second-pass coverage if the primary pass is short

**Files:**

- Create: `apps/vela/src/composables/queries/index.test.ts`
- Optional Create: `apps/vela/src/components/EssentialLink.test.ts`
- Check: `apps/vela/src/composables/queries/index.ts`
- Check: `apps/vela/src/components/EssentialLink.vue`

- [ ] **Step 1: Decide whether this task is required**

Run: `cd apps/vela && bun vitest run --coverage`

Expected: If line coverage is already up by about `+10` percentage points relative to the baseline recorded in Task 1, skip this task entirely.

- [ ] **Step 2: Write the first failing barrel-export test using real exported hook names**

```ts
it('re-exports the query hook modules', async () => {
  const queriesModule = await import('./index');
  expect(typeof queriesModule.useSessionQuery).toBe('function');
  expect(typeof queriesModule.useVocabularyQuestionsQuery).toBe('function');
});
```

- [ ] **Step 3: Run the composables index test**

Run: `cd apps/vela && bun vitest run src/composables/queries/index.test.ts`

Expected: FAIL because the test file does not exist yet.

- [ ] **Step 4: Implement the barrel-export test file**

```ts
it('re-exports the query and mutation hooks', async () => {
  const queriesModule = await import('./index');
  expect(typeof queriesModule.useSessionQuery).toBe('function');
  expect(typeof queriesModule.useCurrentUserQuery).toBe('function');
  expect(typeof queriesModule.useUserProfileQuery).toBe('function');
  expect(typeof queriesModule.useVocabularyQuestionsQuery).toBe('function');
  expect(typeof queriesModule.useSentenceQuestionsQuery).toBe('function');
  expect(typeof queriesModule.useProgressAnalyticsQuery).toBe('function');
  expect(typeof queriesModule.useRecordGameSessionMutation).toBe('function');
  expect(typeof queriesModule.useMyDictionariesQuery).toBe('function');
  expect(typeof queriesModule.useDeleteDictionaryEntryMutation).toBe('function');
  expect(typeof queriesModule.useTTSSettingsQuery).toBe('function');
  expect(typeof queriesModule.useUpdateTTSSettingsMutation).toBe('function');
});
```

- [ ] **Step 5: Add `EssentialLink` coverage only if coverage is still short**

```ts
it('renders the link title, caption, and href', () => {
  const wrapper = mount(EssentialLink, {
    props: { title: 'Docs', caption: 'Read more', link: 'https://example.com', icon: 'book' },
    global: { plugins: [Quasar] },
  });

  expect(wrapper.text()).toContain('Docs');
  expect(wrapper.text()).toContain('Read more');
  expect(wrapper.attributes('href')).toBe('https://example.com');
});
```

- [ ] **Step 6: Run only the optional tests you created**

Run: `cd apps/vela && bun vitest run src/composables/queries/index.test.ts`

Expected: PASS.

If `src/components/EssentialLink.test.ts` was also added, then run:

`cd apps/vela && bun vitest run src/components/EssentialLink.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full suite and re-measure coverage**

Run: `cd apps/vela && bun vitest run && bun vitest run --coverage`

Expected: PASS and line coverage at or above the target increase.

- [ ] **Step 8: Commit**

```bash
git add apps/vela/src/composables/queries/index.test.ts
git add apps/vela/src/components/EssentialLink.test.ts || true
git commit -m "test: add optional app coverage top-up"
```

### Task 7: Final verification and handoff

**Files:**

- No code changes expected

- [ ] **Step 1: Run the final app test suite**

Run: `cd apps/vela && bun vitest run`

Expected: PASS.

- [ ] **Step 2: Run the final coverage command**

Run: `cd apps/vela && bun vitest run --coverage`

Expected: PASS and line coverage improved by about `+10` percentage points relative to the baseline recorded in Task 1.

- [ ] **Step 3: Capture the final verification summary**

Record:

- final passing test status
- final line-coverage percentage
- baseline line-coverage percentage
- net percentage-point increase versus baseline
- whether Task 6 was required
- any small refactors introduced for testability

- [ ] **Step 4: Commit any remaining changes**

```bash
git add apps/vela/src/config/index.test.ts \
  apps/vela/src/components/games/listening/ListeningSetup.test.ts \
  apps/vela/src/boot/main.test.ts \
  apps/vela/src/boot/query.test.ts \
  apps/vela/src/components/NavigationLink.test.ts \
  apps/vela/src/stores/index.test.ts
git add apps/vela/src/composables/queries/index.test.ts || true
git add apps/vela/src/components/EssentialLink.test.ts || true
git commit -m "test: improve app unit coverage"
```
