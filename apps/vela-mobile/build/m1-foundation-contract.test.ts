// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTOMATED_COMMAND_LABELS,
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  createManualM1Manifest,
  hashDirectory,
  hashFile,
  validateAutomatedM1ManifestSemantics,
  validateM1Manifest,
  type M1CommandResult,
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
      apiOrigin: 'https://api.vela.example',
      region: 'us-east-1',
      oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
      cognitoUserPoolId: 'us-east-1_example',
      cognitoMobileUserPoolClientId: 'mobile-client-id',
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

  it('accepts a passed manual manifest backed by deployed configuration and evidence', () => {
    const manifest = createManualM1Manifest({
      testedBehaviorCommit: 'c'.repeat(40),
      matrixClass: 'production-smoke',
      runId: '20260803T021500Z-production-smoke',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      config: validManifest().config,
      host: { deviceAlias: 'test iPhone' },
      evidence: validManifest().evidence,
      findings: [{ severity: 'info', summary: 'Physical observation recorded' }],
      outcome: 'passed',
      linkedAutomatedRunId: '20260803T021500Z-automated',
    });

    expect(manifest.outcome).toBe('passed');
    expect(manifest.exitCode).toBe(0);
    expect(manifest.linkedAutomatedRunId).toBe('20260803T021500Z-automated');
  });

  it('rejects a passed manual manifest with placeholder configuration', () => {
    const config = { ...validManifest().config, class: 'placeholder' as const };

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/deployed configuration/u);
  });

  it('rejects a passed manual manifest with inconsistent public identifiers', () => {
    const config = { ...validManifest().config, publicIdentifiersConsistent: false };

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/consistent public identifiers/u);
  });

  it('rejects a passed manual manifest with empty evidence', () => {
    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config: validManifest().config,
        host: { deviceAlias: 'test iPhone' },
        evidence: [],
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/non-empty evidence/u);
  });

  it('rejects a passed manual manifest whose config source is none', () => {
    const config = { ...validManifest().config, source: 'none' as const };

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/real configuration source/u);
  });

  it.each([
    { name: 'apiOrigin is omitted', omit: 'apiOrigin' },
    { name: 'region is omitted', omit: 'region' },
    { name: 'oauthDomain is omitted', omit: 'oauthDomain' },
    { name: 'cognitoUserPoolId is omitted', omit: 'cognitoUserPoolId' },
    { name: 'cognitoMobileUserPoolClientId is omitted', omit: 'cognitoMobileUserPoolClientId' },
  ])('rejects a passed manual manifest when $name', (scenario) => {
    const fullConfig = validManifest().config;
    const config = { ...fullConfig } as Record<string, unknown>;
    delete config[scenario.omit];
    const omittedConfig = config as typeof fullConfig;

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config: omittedConfig,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/must be a non-empty string/u);
  });

  it('rejects a passed manual manifest with a non-URL apiOrigin', () => {
    const config = { ...validManifest().config, apiOrigin: 'not-even-a-url' } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/valid HTTP or HTTPS URL/u);
  });

  it('rejects a passed manual manifest with a non-HTTP apiOrigin', () => {
    const config = {
      ...validManifest().config,
      apiOrigin: 'ftp://api.vela.example',
    } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/http: or https: protocol/u);
  });

  it('rejects a passed manual manifest with credentials in apiOrigin', () => {
    const config = {
      ...validManifest().config,
      apiOrigin: ['https://user:pass', 'api.vela.example'].join('@'),
    } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/credentials/u);
  });

  it('rejects a passed manual manifest whose apiOrigin carries a non-root path', () => {
    // The contract records only the API origin (protocol + host). Both proof
    // comparisons normalize via `url.origin`, so a pathname like
    // `/unrelated-path` would be silently discarded and the field would persist
    // a misleading value while still matching the automated manifest's origin.
    const config = {
      ...validManifest().config,
      apiOrigin: 'https://api.vela.example/unrelated-path',
    } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/origin only/u);
  });

  it('rejects a passed manual manifest with a malformed region', () => {
    const config = { ...validManifest().config, region: 'wrong-region' };

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/AWS region format/u);
  });

  it('rejects a passed manual manifest with a non-hostname oauthDomain', () => {
    const config = { ...validManifest().config, oauthDomain: 'unrelated.example/path' };

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/bare hostname/u);
  });

  it('rejects a passed manual manifest with a malformed cognitoUserPoolId', () => {
    const config = {
      ...validManifest().config,
      cognitoUserPoolId: 'wrong-pool-id',
    } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/Cognito user pool ID format/u);
  });

  it('rejects a passed manual manifest with a malformed cognitoMobileUserPoolClientId', () => {
    const config = {
      ...validManifest().config,
      cognitoMobileUserPoolClientId: 'sh!',
    } as ReturnType<typeof validManifest>['config'];

    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/alphanumeric client identifier/u);
  });

  it('accepts a passed manual manifest with a loopback HTTP apiOrigin', () => {
    const config = {
      ...validManifest().config,
      apiOrigin: 'http://127.0.0.1:9000',
    } as ReturnType<typeof validManifest>['config'];

    const manifest = createManualM1Manifest({
      testedBehaviorCommit: 'c'.repeat(40),
      matrixClass: 'production-smoke',
      runId: '20260803T021500Z-production-smoke',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      config,
      host: { deviceAlias: 'test iPhone' },
      evidence: validManifest().evidence,
      findings: [],
      outcome: 'passed',
      linkedAutomatedRunId: '20260803T021500Z-automated',
    });

    expect(manifest.outcome).toBe('passed');
  });

  it('rejects a manual manifest whose run-ID suffix disagrees with the matrix class', () => {
    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-diagnostic-observation',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config: validManifest().config,
        host: { deviceAlias: 'test iPhone' },
        evidence: [],
        findings: [],
        outcome: 'gate_failed',
      }),
    ).toThrow(/runId suffix must agree with matrixClass/u);
  });

  it('enforces manual manifest fields against untyped runtime input', () => {
    const hostileInput = {
      schemaVersion: 2,
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

  it('rejects a passed manual manifest without linkedAutomatedRunId', () => {
    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config: validManifest().config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
      }),
    ).toThrow(/linkedAutomatedRunId/u);
  });

  it('rejects a passed manual manifest with a malformed linkedAutomatedRunId', () => {
    expect(() =>
      createManualM1Manifest({
        testedBehaviorCommit: 'c'.repeat(40),
        matrixClass: 'production-smoke',
        runId: '20260803T021500Z-production-smoke',
        startedAt: '2026-08-03T02:15:00.000Z',
        endedAt: '2026-08-03T02:17:00.000Z',
        config: validManifest().config,
        host: { deviceAlias: 'test iPhone' },
        evidence: validManifest().evidence,
        findings: [],
        outcome: 'passed',
        linkedAutomatedRunId: 'not-a-run-id',
      }),
    ).toThrow(/run ID format/u);
  });

  it('does not require linkedAutomatedRunId for a non-passed manual manifest', () => {
    const manifest = createManualM1Manifest({
      testedBehaviorCommit: 'c'.repeat(40),
      matrixClass: 'production-smoke',
      runId: '20260803T021500Z-production-smoke',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      config: validManifest().config,
      host: { deviceAlias: 'test iPhone' },
      evidence: [],
      findings: [],
      outcome: 'gate_failed',
    });

    expect(manifest.linkedAutomatedRunId).toBeUndefined();
  });
});

describe('validateAutomatedM1ManifestSemantics', () => {
  function automatedCommandResult(label: string, status: 'passed' | 'failed' = 'passed'): M1CommandResult {
    return {
      label,
      command: 'bun',
      cwd: '.',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:15:01.000Z',
      elapsedMs: 1000,
      exitCode: status === 'passed' ? 0 : 1,
      status,
    };
  }

  function automatedManifest(commands: M1CommandResult[]): M1Manifest {
    return {
      schemaVersion: 1,
      runId: '20260803T021500Z-automated',
      testedBehaviorCommit: 'a'.repeat(40),
      phase: 'automated',
      matrixClass: 'automated',
      startedAt: '2026-08-03T02:15:00.000Z',
      endedAt: '2026-08-03T02:17:00.000Z',
      outcome: 'passed',
      exitCode: 0,
      config: {
        source: 'process_env',
        class: 'deployed',
        apiOrigin: 'https://api.vela.example',
        region: 'us-east-1',
        oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
        cognitoUserPoolId: 'us-east-1_example',
        cognitoMobileUserPoolClientId: 'mobile-client-id',
        publicIdentifiersConsistent: true,
      },
      host: { platform: 'darwin' },
      commands,
      evidence: [],
      findings: [],
    };
  }

  it('accepts a passed automated manifest with all expected gates in order', () => {
    const commands = AUTOMATED_COMMAND_LABELS.map((label) => automatedCommandResult(label));
    const manifest = automatedManifest(commands);

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).not.toThrow();
  });

  it('rejects a passed automated manifest with empty commands', () => {
    const manifest = automatedManifest([]);

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).toThrow(
      /exactly 8 command results, got 0/u,
    );
  });

  it('rejects a passed automated manifest with a missing gate', () => {
    const commands = AUTOMATED_COMMAND_LABELS.slice(0, -1).map((label) => automatedCommandResult(label));
    const manifest = automatedManifest(commands);

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).toThrow(
      /exactly 8 command results, got 7/u,
    );
  });

  it('rejects a passed automated manifest with a wrong label', () => {
    const commands = AUTOMATED_COMMAND_LABELS.map((label) => automatedCommandResult(label));
    commands[3] = automatedCommandResult('wrong-label');
    const manifest = automatedManifest(commands);

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).toThrow(
      /command\[3\] must be "compile"/u,
    );
  });

  it('rejects a passed automated manifest with a failed gate', () => {
    const commands = AUTOMATED_COMMAND_LABELS.map((label) => automatedCommandResult(label));
    commands[4] = automatedCommandResult('build', 'failed');
    const manifest = automatedManifest(commands);

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).toThrow(
      /"build" must have passed status/u,
    );
  });

  it('skips semantic validation for a non-passed automated manifest', () => {
    const manifest = automatedManifest([]);
    manifest.outcome = 'gate_failed';
    manifest.exitCode = 4;

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).not.toThrow();
  });

  it('skips semantic validation for a non-automated matrix class', () => {
    const manifest = automatedManifest([]);
    manifest.matrixClass = 'production-smoke';
    manifest.runId = '20260803T021500Z-production-smoke';

    expect(() => validateAutomatedM1ManifestSemantics(manifest)).not.toThrow();
  });
});
