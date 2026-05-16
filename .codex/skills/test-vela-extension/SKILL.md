---
name: test-vela-extension
description: Run and verify the Vela browser extension local test workflow. Use when working in the Vela monorepo on apps/vela-ext, WXT, browser extension context menus, extension login/session import behavior, the one-command dev:extension-test loop, Chrome DevTools/browser MCP inspection, or the extension-test.html fixture.
---

# Test Vela Extension

Use this skill to exercise the Vela extension with the app, API, WXT runner, and browser MCP in one loop.

## Workflow

1. Work from the Vela monorepo root, not `apps/vela-ext`:

   ```bash
   bun run dev:extension-test
   ```

   Keep the command session open while testing. Wait for all of these signals:
   - Quasar reports `App URL................ http://localhost:9000/`
   - API reports `Vela API development server running on port 9005`
   - WXT reports `Started dev server @ http://localhost:3000`
   - WXT reports `Built extension`
   - WXT reports `Opened browser`

2. Use browser MCP / Chrome DevTools after startup. `mcp__chrome_devtools__.list_pages` should show:
   - `http://localhost:9000/auth/login`
   - `http://localhost:9000/extension-test.html`

   If MCP cannot connect, inspect `apps/vela-ext/wxt.config.ts`. In extension test mode, `webExt.chromiumArgs` must include `--remote-debugging-port=9222`, and WXT must be restarted after changing it.

3. Select the fixture page and take a snapshot. It should contain:
   - title `Vela Extension Test Fixture`
   - instruction `Select a sentence, right-click, then choose Add vocab to Vela.`
   - Japanese sample sentences including `今日は新しい単語を三つ覚えました。`

4. Verify extension runtime targets through Chrome DevTools:

   ```bash
   curl -s http://127.0.0.1:9222/json/list
   ```

   Expect two page targets plus a `service_worker` target whose URL is `chrome-extension://.../background.js`.

5. Do not claim the native right-click menu itself was inspected through MCP. Chrome native context menus and toolbar popups are not reliably exposed to page-level DevTools automation. Instead, verify the same extension path by sending a scan message from the loaded service worker:

   ```bash
   bun /path/to/test-vela-extension/scripts/trigger_scan.mjs
   ```

   Then take a browser MCP snapshot of `http://localhost:9000/extension-test.html`. Expect the overlay:
   - `Found 3 Japanese sentences`
   - three checked Japanese sentence checkboxes
   - button `Save selected (3)`

6. For unauthenticated behavior, click `Save selected (3)` from MCP. Expect the overlay to report `3 could not be saved (not signed in)` and no page console errors. This confirms the no-session path is handled without extension login/logout UI.

7. When finished, stop every process started for the test. Check and clear these ports:

   ```bash
   lsof -ti :3000 -ti :9000 -ti :9005 -ti :9222
   ```

   Kill only the listed dev/test processes you started, then rerun the `lsof` command and expect no output.

## Expected Project Hooks

If the workflow is missing or broken, inspect these files before inventing a new path:

- root `package.json`: `dev:extension-test` should run Turbo for `apps/vela`, `apps/vela-api`, and `apps/vela-ext`
- `apps/vela/package.json`: `dev:extension-test` should delegate to `bun run dev`
- `apps/vela-api/package.json`: `dev:extension-test` should delegate to `bun run dev`
- `apps/vela-ext/package.json`: `dev:extension-test` should run `VELA_EXT_TEST_MODE=1 wxt`
- `apps/vela-ext/wxt.config.ts`: `webExt` should open login plus fixture pages with a persistent `.wxt/chrome-data` profile and DevTools port `9222`
- `apps/vela/public/extension-test.html`: fixture page for context-menu and scan testing

## Verification

For workflow/config changes, run at least:

```bash
bun run test:unit -- tests/devWorkflow.test.ts
bun run compile
git diff --check
```

For extension behavior changes, prefer the full runtime loop above and report exactly which MCP snapshots, console checks, and unauthenticated/authenticated paths were verified.
