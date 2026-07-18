// @vitest-environment node
//
// Regression tests for the VITE_APP_VERSION resolution precedence in
// sync-ios-version.mjs. These lock the behavior that two prior code-review
// P1 comments incorrectly proposed changing:
//
//  1. The script checks Vite-style `.env.production` / `.env.development`,
//     NOT Quasar-style `.env.prod` / `.env.capacitor`. The Home page reads
//     `import.meta.env.VITE_APP_VERSION`, which Vite's own `loadEnv` populates
//     — and Vite loads `.env.[mode]`, not Quasar's `.env.[dev|prod]`. Checking
//     Quasar-style names would read files Vite never loads and reintroduce
//     UI/native version drift.
//  2. `process.env.VITE_APP_VERSION` (incl. Bun's auto-loaded `.env`) is given
//     highest priority, matching Vite's `loadEnv`. This is NOT a bug — Vite
//     behaves identically, so honoring it keeps the script aligned with what
//     the Home page actually resolves.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVersion, resolveFileEnvVersion } from './sync-ios-version.mjs';

describe('sync-ios-version resolveVersion', () => {
  let dir;

  const writePkg = (version) =>
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  const writeEnv = (file, content) => writeFileSync(join(dir, file), content);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vela-sync-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('process.env.VITE_APP_VERSION wins over .env files (Vite loadEnv priority)', () => {
    writePkg('0.0.1');
    writeEnv('.env.production', 'VITE_APP_VERSION=2.2.2\n');
    const { version } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: { VITE_APP_VERSION: '1.1.1' },
    });
    expect(version).toBe('1.1.1');
  });

  it('loads Vite-style .env.production; ignores Quasar-style .env.prod', () => {
    writePkg('0.0.1');
    writeEnv('.env.prod', 'VITE_APP_VERSION=3.3.3\n');
    writeEnv('.env.production', 'VITE_APP_VERSION=2.2.2\n');
    const { version } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: {},
    });
    expect(version).toBe('2.2.2');
  });

  it('falls back to package.json version when no env source defines it', () => {
    writePkg('1.2.3');
    const { version, processEnvVersion, fileEnvVersion, pkgVersion } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: {},
    });
    expect(version).toBe('1.2.3');
    expect(processEnvVersion).toBeUndefined();
    expect(fileEnvVersion).toBeUndefined();
    expect(pkgVersion).toBe('1.2.3');
  });

  it('Bun-loaded .env (in processEnv) wins over .env.production — matches Vite, no drift', () => {
    // The exact scenario a reviewer flagged as a P1 bug: .env=1.1.1,
    // .env.production=2.2.2. Vite's loadEnv gives the existing process.env
    // value (Bun-loaded .env) highest priority, so the Home page shows 1.1.1.
    // The script must resolve the same value or the iOS bundle drifts.
    writePkg('0.0.1');
    writeEnv('.env', 'VITE_APP_VERSION=1.1.1\n');
    writeEnv('.env.production', 'VITE_APP_VERSION=2.2.2\n');
    const { version } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: { VITE_APP_VERSION: '1.1.1' },
    });
    expect(version).toBe('1.1.1');
  });

  it('.env.[mode] overrides .env (later files win)', () => {
    writePkg('0.0.1');
    writeEnv('.env', 'VITE_APP_VERSION=1.1.1\n');
    writeEnv('.env.production', 'VITE_APP_VERSION=2.2.2\n');
    const { version } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: {},
    });
    expect(version).toBe('2.2.2');
  });

  it('mode selects the mode-specific file (.env.development vs .env.production)', () => {
    writePkg('0.0.1');
    writeEnv('.env.development', 'VITE_APP_VERSION=0.0.1-dev\n');
    writeEnv('.env.production', 'VITE_APP_VERSION=1.0.0\n');
    const dev = resolveVersion({
      root: dir,
      mode: 'development',
      processEnv: {},
    });
    const prod = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: {},
    });
    expect(dev.version).toBe('0.0.1-dev');
    expect(prod.version).toBe('1.0.0');
  });

  it('resolveFileEnvVersion returns undefined when no file defines VITE_APP_VERSION', () => {
    writePkg('0.0.1');
    writeEnv('.env', 'OTHER=1\n');
    expect(resolveFileEnvVersion(dir, 'production', {})).toBeUndefined();
  });

  it('resolveFileEnvVersion ignores Quasar-style .env.capacitor for capacitor mode', () => {
    // Quasar loads .env.capacitor; Vite does not. The Home page reads
    // import.meta.env (Vite), so the script must NOT pick up .env.capacitor.
    writePkg('0.0.1');
    writeEnv('.env.capacitor', 'VITE_APP_VERSION=9.9.9\n');
    expect(resolveFileEnvVersion(dir, 'production', {})).toBeUndefined();
  });

  it('$VAR references resolve against processEnv, not the merged file value (Vite loadEnv precedence)', () => {
    // Regression for a reviewer-flagged P2: .env defines BASE=one,
    // .env.production redefines BASE=two, and VITE_APP_VERSION=$BASE. Vite's
    // loadEnv expands $BASE against process.env (Bun auto-loads .env so
    // process.env.BASE=one), so the Home page resolves VITE_APP_VERSION=one.
    // The script must match or the iOS MARKETING_VERSION drifts to 'two' (the
    // merged file value). VITE_APP_VERSION is intentionally NOT in processEnv
    // so the file-resolution path (and $BASE expansion) is exercised.
    writePkg('0.0.1');
    writeEnv('.env', 'BASE=one\n');
    writeEnv('.env.production', 'BASE=two\nVITE_APP_VERSION=$BASE\n');
    const { version, fileEnvVersion } = resolveVersion({
      root: dir,
      mode: 'production',
      processEnv: { BASE: 'one' },
    });
    expect(fileEnvVersion).toBe('one');
    expect(version).toBe('one');
  });
});
