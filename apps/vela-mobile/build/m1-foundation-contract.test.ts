// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  createManualM1Manifest,
  hashDirectory,
  hashFile,
  validateM1Manifest,
  type M1Manifest,
  type M1MatrixClass,
} from './m1-foundation-contract';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vela-m1-contract-'));
  temporaryDirectories.push(directory);
  return directory;
}

function validManifest(): M1Manifest {
  return {
    schemaVersion: 1,
    runId: '20260803T021500Z-production-smoke',
    testedBehaviorCommit: 'a'.repeat(40),
    phase: 'manual',
    matrixClass: 'production-smoke',
    startedAt: '2026-08-03T02:15:00.000Z',
    endedAt: '2026-08-03T02:16:00.000Z',
    outcome: 'passed',
    exitCode: 0,
    config: {
      source: 'process_env',
      class: 'deployed',
      apiOrigin: 'https://api.vela.example/api/',
      region: 'us-east-1',
      oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
      publicIdentifiersConsistent: true,
    },
    host: {
      operatingSystem: 'macOS',
      xcodeVersion: '16.0',
    },
    commands: [],
    evidence: [
      {
        kind: 'attachment',
        location: 'https://evidence.vela.example/production-smoke.png',
        mediaType: 'image/png',
        byteSize: 42,
        sha256: 'b'.repeat(64),
      },
    ],
    findings: [{ severity: 'low', summary: 'No blocking findings' }],
  };
}

describe('M1 foundation manifest contract', () => {
  it('maps every outcome to the stable exit code', () => {
    expect(M1_EXIT_CODE).toEqual({
      passed: 0,
      harness_error: 1,
      usage_error: 2,
      prerequisite_missing: 3,
      gate_failed: 4,
    });
  });

  it('creates UTC run IDs', () => {
    expect(
      createM1RunId(new Date('2026-08-03T02:15:00.000Z'), 'production-smoke'),
    ).toBe('20260803T021500Z-production-smoke');
  });

  it('rejects matrix classes that could escape a run directory', () => {
    const matrixClass = 'production/smoke' as unknown as M1MatrixClass;

    expect(() => createM1RunId(new Date('2026-08-03T02:15:00.000Z'), matrixClass)).toThrow(
      /path separator/u,
    );
  });

  it('creates the versioned evidence path', () => {
    expect(
      createM1RunDirectory({
        evidenceRoot: '/repo/apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit: 'a'.repeat(40),
        runId: '20260803T021500Z-production-smoke',
      }),
    ).toBe(
      `/repo/apps/vela-mobile/docs/evidence/hpa-210/${'a'.repeat(40)}/20260803T021500Z-production-smoke`,
    );
  });

  it('rejects abbreviated behavior commits in evidence paths', () => {
    expect(() =>
      createM1RunDirectory({
        evidenceRoot: '/repo/apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit: 'a'.repeat(39),
        runId: '20260803T021500Z-production-smoke',
      }),
    ).toThrow(/40-character/u);
  });

  it('hashes file bytes with SHA-256', async () => {
    const directory = createTemporaryDirectory();
    const file = join(directory, 'evidence.txt');
    writeFileSync(file, 'hello');

    expect(await hashFile(file)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('hashes equivalent directory trees independently of creation order', async () => {
    const first = createTemporaryDirectory();
    const second = createTemporaryDirectory();
    mkdirSync(join(first, 'nested'));
    mkdirSync(join(second, 'nested'));

    writeFileSync(join(first, 'z.txt'), 'zeta');
    writeFileSync(join(first, 'nested', 'a.txt'), 'alpha');
    writeFileSync(join(second, 'nested', 'a.txt'), 'alpha');
    writeFileSync(join(second, 'z.txt'), 'zeta');

    expect(await hashDirectory(first)).toBe(await hashDirectory(second));
  });

  it('includes each relative path in a directory hash', async () => {
    const first = createTemporaryDirectory();
    const second = createTemporaryDirectory();
    writeFileSync(join(first, 'first.txt'), 'same content');
    writeFileSync(join(second, 'second.txt'), 'same content');

    expect(await hashDirectory(first)).not.toBe(await hashDirectory(second));
  });

  it('detects changed file content in a directory hash', async () => {
    const first = createTemporaryDirectory();
    const second = createTemporaryDirectory();
    writeFileSync(join(first, 'evidence.txt'), 'first observation');
    writeFileSync(join(second, 'evidence.txt'), 'second observation');

    expect(await hashDirectory(first)).not.toBe(await hashDirectory(second));
  });

  it('rejects a manifest whose outcome and exit code disagree', () => {
    const manifest = validManifest();
    manifest.outcome = 'gate_failed';

    expect(() => validateM1Manifest(manifest)).toThrow();
  });

  it('rejects a manifest with a non-full behavior commit', () => {
    const manifest = validManifest();
    manifest.testedBehaviorCommit = 'a'.repeat(39);

    expect(() => validateM1Manifest(manifest)).toThrow(/40-character/u);
  });

  it('constructs manual manifests under the supplied behavior commit', () => {
    const manifest = createManualM1Manifest({
      testedBehaviorCommit: 'c'.repeat(40),
      matrixClass: 'diagnostic-observation',
      runId: '20260803T021500Z-diagnostic-observation',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      config: validManifest().config,
      host: { deviceAlias: 'test iPhone' },
      evidence: [],
      findings: [{ severity: 'info', summary: 'Physical observation recorded' }],
      outcome: 'gate_failed',
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      runId: '20260803T021500Z-diagnostic-observation',
      testedBehaviorCommit: 'c'.repeat(40),
      phase: 'manual',
      matrixClass: 'diagnostic-observation',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      outcome: 'gate_failed',
      exitCode: 4,
      config: validManifest().config,
      host: { deviceAlias: 'test iPhone' },
      commands: [],
      evidence: [],
      findings: [{ severity: 'info', summary: 'Physical observation recorded' }],
    });
  });

  it('enforces manual manifest fields against untyped runtime input', () => {
    const hostileInput = {
      testedBehaviorCommit: 'd'.repeat(40),
      matrixClass: 'production-smoke',
      runId: '20260803T021500Z-production-smoke',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      config: validManifest().config,
      host: { deviceAlias: 'test iPhone' },
      evidence: [],
      findings: [{ severity: 'info', summary: 'Physical observation recorded' }],
      outcome: 'gate_failed',
      phase: 'ios-simulator',
      exitCode: 0,
      commands: [
        {
          label: 'injected-command',
          command: 'false',
          cwd: '/tmp',
          startedAt: '2026-08-03T02:15:00.000Z',
          endedAt: '2026-08-03T02:15:00.000Z',
          elapsedMs: 0,
          exitCode: 0,
          status: 'passed',
        },
      ],
    } as unknown as Parameters<typeof createManualM1Manifest>[0];

    const manifest = createManualM1Manifest(hostileInput);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.phase).toBe('manual');
    expect(manifest.exitCode).toBe(4);
    expect(manifest.commands).toEqual([]);
  });
});
