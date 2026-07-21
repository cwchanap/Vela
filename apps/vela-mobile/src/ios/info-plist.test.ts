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

// Extract the first <dict> inside CFBundleURLTypes so we can assert on the
// sibling keys (CFBundleURLName, CFBundleTypeRole) that Capacitor syncs have
// been observed to drop while leaving CFBundleURLSchemes intact.
//
// The CFBundleURLTypes <array> contains a nested <array> (CFBundleURLSchemes),
// so a non-greedy match on the outer array would stop at the inner </array>.
// Anchor on `</array>\s*</dict>\s*</plist>` — the root plist dict close — to
// uniquely identify the outer CFBundleURLTypes array.
function extractUrlTypeEntry(xml: string): string | null {
  const blockMatch = xml.match(
    /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)<\/array>\s*<\/dict>\s*<\/plist>/,
  );
  if (!blockMatch) return null;
  const dictMatch = blockMatch[1].match(/<dict>([\s\S]*?)<\/dict>/);
  return dictMatch ? dictMatch[1] : null;
}

function extractKeyValue(xml: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

describe('iOS Info.plist', () => {
  test('registers the dev.cwchanap.vela.oauth custom URL scheme', () => {
    const schemes = extractSchemes(plistContent);
    expect(schemes).toContain('dev.cwchanap.vela.oauth');
  });

  test('CFBundleURLTypes entry declares CFBundleURLName and CFBundleTypeRole', () => {
    const entry = extractUrlTypeEntry(plistContent);
    expect(
      entry,
      'CFBundleURLTypes dict entry missing — Capacitor sync may have wiped it',
    ).not.toBeNull();
    if (!entry) return;

    const urlName = extractKeyValue(entry, 'CFBundleURLName');
    const typeRole = extractKeyValue(entry, 'CFBundleTypeRole');

    expect(urlName, 'CFBundleURLName missing inside CFBundleURLTypes dict').not.toBeNull();
    expect(typeRole, 'CFBundleTypeRole missing inside CFBundleURLTypes dict').not.toBeNull();
    // Editor is the correct role for an app that handles OAuth callbacks it
    // initiates; Viewer would still work but Editor is the documented convention.
    expect(typeRole).toBe('Editor');
  });
});
