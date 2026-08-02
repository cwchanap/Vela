import { createHash } from 'node:crypto';

export type MobileSecretRuleId =
  | 'secret_sentinel'
  | 'bearer_value'
  | 'jwt_value'
  | 'private_key'
  | 'aws_secret'
  | 'provider_key'
  | 'presigned_url';

export type MobileSecretFinding = {
  ruleId: MobileSecretRuleId;
  path: string;
  line: number;
  valueClass: string;
  fingerprint: string;
};

export type MobileSecretScanInput = {
  path: string;
  text: string;
  allowPolicySentinelLiterals?: boolean;
};

export const SECRET_SENTINELS = [
  'SECRET-access-token',
  'SECRET-id-token',
  'SECRET-refresh-token',
  'SECRET-rotated-refresh-token',
] as const;

export const LOG_AND_DOM_SENTINELS = [
  ...SECRET_SENTINELS,
  'SECRET-authorization-url',
  'SECRET-callback-code',
  'SECRET-code-verifier',
  'SECRET-nonce',
  'SECRET-claim-email',
  'Bearer SECRET-caller-authorization',
  'https://evil.example/SECRET-rejected-path',
] as const;

export const NON_SCHEMA_STORAGE_SENTINELS = [
  'SECRET-callback-code',
  'SECRET-claim-email',
  'SECRET-raw-request',
  'SECRET-raw-response',
  'SECRET-native-exception',
  'Bearer SECRET-caller-authorization',
  'https://evil.example/SECRET-rejected-path',
] as const;

export const PUBLIC_CONFIGURATION_KEYS: ReadonlySet<string> = new Set([
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
]);

export const TEST_FIXTURE_SECRET_VALUES: ReadonlySet<string> = new Set(
  [...SECRET_SENTINELS, ...LOG_AND_DOM_SENTINELS, ...NON_SCHEMA_STORAGE_SENTINELS].flatMap(
    (sentinel) => sentinel.match(/SECRET-[A-Za-z0-9-]+/gu) ?? [],
  ),
);

export const TEST_FIXTURE_VALUE_SUFFIXES = ['.example.test', 'example.invalid'] as const;

const BEARER_PATTERN = /Authorization:\s*Bearer\s+([^\s"'`]+)/giu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu;
const PRESIGNED_URL_PATTERN =
  /https?:\/\/[^\s"'`?]+\?[^\s"'`]*(?:X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token)=[^\s"'`]*/giu;
const AWS_SECRET_ASSIGNMENT_PATTERN =
  /\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|awsSecretAccessKey)\b\s*(?:=|:)\s*(?:(['"`])([A-Za-z0-9/+=]{40})\1|([A-Za-z0-9/+=]{40}))(?![A-Za-z0-9/+=])/giu;
const PROVIDER_SECRET_ASSIGNMENT_PATTERN =
  /\b(?:ANTHROPIC_API_KEY|COHERE_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GROQ_API_KEY|HUGGINGFACE_API_KEY|HF_TOKEN|MISTRAL_API_KEY|OPENAI_API_KEY|OPENAI_KEY|PERPLEXITY_API_KEY|SENTRY_AUTH_TOKEN|SLACK_BOT_TOKEN|SLACK_TOKEN|STRIPE_SECRET_KEY)\b\s*(?:=|:)\s*(?:(['"`])([^\s"'`]{12,})\1|([^\s,;}\]]{12,}))/giu;

type Candidate = {
  finding: MobileSecretFinding;
  start: number;
  end: number;
  rawValue: string;
  priority: number;
};

function finding(
  ruleId: MobileSecretRuleId,
  path: string,
  line: number,
  valueClass: string,
  rawValue: string,
): MobileSecretFinding {
  return {
    ruleId,
    path,
    line,
    valueClass,
    fingerprint: createHash('sha256').update(rawValue).digest('hex'),
  };
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function candidate(
  ruleId: MobileSecretRuleId,
  path: string,
  text: string,
  start: number,
  rawValue: string,
  valueClass: string,
  priority: number,
): Candidate {
  return {
    finding: finding(ruleId, path, lineAt(text, start), valueClass, rawValue),
    start,
    end: start + rawValue.length,
    rawValue,
    priority,
  };
}

function addPatternCandidates(
  candidates: Candidate[],
  input: MobileSecretScanInput,
  pattern: RegExp,
  ruleId: MobileSecretRuleId,
  valueClass: string,
  priority: number,
  valueForMatch: (match: RegExpExecArray) => string | undefined,
): void {
  pattern.lastIndex = 0;
  let match = pattern.exec(input.text);
  while (match) {
    const rawValue = valueForMatch(match);
    if (rawValue) {
      const start = match.index + match[0].lastIndexOf(rawValue);
      candidates.push(candidate(ruleId, input.path, input.text, start, rawValue, valueClass, priority));
    }
    match = pattern.exec(input.text);
  }
}

function overlaps(left: Candidate, right: Candidate): boolean {
  return left.start < right.end && right.start < left.end;
}

function isTestFixturePath(path: string): boolean {
  return /(?:^|[/\\])[^/\\]+\.(?:test|spec)\.[^/\\]+$/u.test(path);
}

function isJavaScriptTemplatePlaceholder(rawValue: string): boolean {
  return /^\$\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\}?$/u.test(rawValue);
}

function isTestFixtureUrl(rawValue: string): boolean {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const hostname = url.hostname.toLowerCase();
    return TEST_FIXTURE_VALUE_SUFFIXES.some((suffix) => {
      const fixtureHost = suffix.replace(/^\./u, '').toLowerCase();
      return hostname === fixtureHost || hostname.endsWith(`.${fixtureHost}`);
    });
  } catch {
    return false;
  }
}

export function isMobileSecretFixtureValue(rawValue: string): boolean {
  return TEST_FIXTURE_SECRET_VALUES.has(rawValue) || isTestFixtureUrl(rawValue);
}

function isAllowedTestFixtureCandidate(candidate: Candidate): boolean {
  if (TEST_FIXTURE_SECRET_VALUES.has(candidate.rawValue)) return true;
  return candidate.finding.ruleId === 'presigned_url' && isTestFixtureUrl(candidate.rawValue);
}

export function scanMobileSecretText(input: MobileSecretScanInput): MobileSecretFinding[] {
  const candidates: Candidate[] = [];

  addPatternCandidates(
    candidates,
    input,
    PRIVATE_KEY_PATTERN,
    'private_key',
    'private_key_header',
    0,
    (match) => match[0],
  );
  addPatternCandidates(
    candidates,
    input,
    PRESIGNED_URL_PATTERN,
    'presigned_url',
    'aws_presigned_url',
    1,
    (match) => match[0],
  );
  addPatternCandidates(
    candidates,
    input,
    BEARER_PATTERN,
    'bearer_value',
    'authorization_bearer',
    2,
    (match) => match[1],
  );
  addPatternCandidates(candidates, input, JWT_PATTERN, 'jwt_value', 'jwt', 3, (match) => match[0]);
  addPatternCandidates(
    candidates,
    input,
    AWS_SECRET_ASSIGNMENT_PATTERN,
    'aws_secret',
    'aws_secret_access_key',
    4,
    (match) => match[2] ?? match[3],
  );
  addPatternCandidates(
    candidates,
    input,
    PROVIDER_SECRET_ASSIGNMENT_PATTERN,
    'provider_key',
    'provider_api_key',
    5,
    (match) => match[2] ?? match[3],
  );

  for (const sentinel of TEST_FIXTURE_SECRET_VALUES) {
    let start = input.text.indexOf(sentinel);
    while (start !== -1) {
      candidates.push(
        candidate(
          'secret_sentinel',
          input.path,
          input.text,
          start,
          sentinel,
          'known_secret_sentinel',
          6,
        ),
      );
      start = input.text.indexOf(sentinel, start + sentinel.length);
    }
  }

  const findings = candidates
    .filter((current) => !isJavaScriptTemplatePlaceholder(current.rawValue))
    .filter(
      (current) =>
        !(input.allowPolicySentinelLiterals && current.finding.ruleId === 'secret_sentinel'),
    )
    .filter((current) => !isTestFixturePath(input.path) || !isAllowedTestFixtureCandidate(current))
    .sort((left, right) => left.start - right.start || left.priority - right.priority)
    .filter((current, index, sorted) => !sorted.slice(0, index).some((prior) => overlaps(prior, current)));

  return findings.map(({ finding: result }) => result);
}
