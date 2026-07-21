import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Parse the plist as XML without adding a runtime dependency.
// The Info.plist is small and stable; a regex on the raw text is enough
// to catch "a Capacitor sync wiped the CFBundleURLTypes entry".
const plistPath = resolve(__dirname, '../../src-capacitor/ios/App/App/Info.plist');
const plistContent = readFileSync(plistPath, 'utf8');

function extractSchemes(xml: string): string[] {
  const schemes: string[] = [];
  const blockMatch = xml.match(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!blockMatch) return schemes;
  const stringRegex = /<string>([^<]+)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(blockMatch[1])) !== null) {
    schemes.push(match[1]);
  }
  return schemes;
}

describe('iOS Info.plist', () => {
  test('registers the dev.cwchanap.vela.oauth custom URL scheme', () => {
    const schemes = extractSchemes(plistContent);
    expect(schemes).toContain('dev.cwchanap.vela.oauth');
  });
});
