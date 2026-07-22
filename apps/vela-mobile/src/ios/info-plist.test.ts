import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Parse the plist as XML without adding a runtime dependency.
// The Info.plist is small and stable; a regex on the raw text is enough
// to catch "a Capacitor sync wiped the CFBundleURLTypes entry".
const plistPath = resolve(__dirname, '../../src-capacitor/ios/App/App/Info.plist');
const plistContent = readFileSync(plistPath, 'utf8');

// Binary plists start with `bplist00`. Xcode occasionally converts Info.plist
// to binary format (e.g. after a merge conflict resolution or an Xcode
// version upgrade). The regex-based extractors below return null/empty on
// binary plists, which would surface as misleading "Capacitor sync wiped
// CFBundleURLTypes" failures. Wrapped in a test() so a binary plist surfaces
// as a named per-test failure with a clear remediation message, instead of a
// module-load error that obscures which test file failed.
const isBinaryPlist = plistContent.startsWith('bplist');

function extractSchemes(xml: string): string[] {
  const schemes: string[] = [];
  const blockMatch = xml.match(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!blockMatch || blockMatch[1] === undefined) return schemes;
  const blockBody = blockMatch[1];
  const stringRegex = /<string>([^<]+)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(blockBody)) !== null) {
    if (match[1] !== undefined) schemes.push(match[1]);
  }
  return schemes;
}

// Extract the first <dict> inside CFBundleURLTypes so we can assert on the
// sibling keys (CFBundleURLName, CFBundleTypeRole) that Capacitor syncs have
// been observed to drop while leaving CFBundleURLSchemes intact.
//
// The CFBundleURLTypes <array> contains a nested <array> (CFBundleURLSchemes),
// so a non-greedy regex on the outer array would stop at the inner </array>.
// Tracking <array>/</array> depth from the CFBundleURLTypes key is robust to
// any sibling keys appended after it (NSAppTransportSecurity, etc.) — a
// previous regex anchored on `</dict>\s*</plist>` and would silently return
// null (false alarm) the moment CFBundleURLTypes was no longer the last key.
function extractUrlTypeEntry(xml: string): string | null {
  const keyIdx = xml.indexOf('<key>CFBundleURLTypes</key>');
  if (keyIdx === -1) return null;
  const afterKey = xml.slice(keyIdx);
  const arrayOpen = afterKey.match(/\s*<array>/);
  if (!arrayOpen || arrayOpen.index === undefined) return null;
  // arrayOpen.index points at the start of the leading whitespace; arrayOpen[0]
  // is the full match including that whitespace, so its length lands us right
  // after the opening <array> tag.
  const start = keyIdx + arrayOpen.index + arrayOpen[0].length;

  // Walk <array>/</array> tags to find the matching close of the outer array.
  let depth = 1;
  let i = start;
  const tag = /<\/?array>/g;
  tag.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    depth += match[0] === '<array>' ? 1 : -1;
    if (depth === 0) {
      i = match.index;
      break;
    }
  }
  if (depth !== 0) return null;
  const outerArrayBody = xml.slice(start, i);

  // Extract the first top-level <dict>...</dict> inside the outer array,
  // tracking <dict>/</dict> depth so nested dicts don't trip the match.
  const dictOpenIdx = outerArrayBody.indexOf('<dict>');
  if (dictOpenIdx === -1) return null;
  let dictDepth = 0;
  let dictStart = -1;
  let dictEnd = -1;
  const dictTagRegex = /<\/?dict>/g;
  dictTagRegex.lastIndex = dictOpenIdx;
  let dictMatch: RegExpExecArray | null;
  while ((dictMatch = dictTagRegex.exec(outerArrayBody)) !== null) {
    if (dictMatch[0] === '<dict>') {
      if (dictDepth === 0) dictStart = dictMatch.index + '<dict>'.length;
      dictDepth += 1;
    } else {
      dictDepth -= 1;
      if (dictDepth === 0) {
        dictEnd = dictMatch.index;
        break;
      }
    }
  }
  if (dictStart === -1 || dictEnd === -1) return null;
  return outerArrayBody.slice(dictStart, dictEnd);
}

function extractKeyValue(xml: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
  const m = xml.match(re);
  return m && m[1] !== undefined ? m[1] : null;
}

describe('iOS Info.plist', () => {
  test('Info.plist is XML, not binary', () => {
    // Fail fast with a clear remediation message before the regex-based
    // assertions below would produce misleading "Capacitor sync wiped
    // CFBundleURLTypes" failures on a binary plist.
    expect(
      !isBinaryPlist,
      `${plistPath} is a binary plist. Convert it back to XML: plutil -convert xml1 "${plistPath}". The Info.plist test assumes XML text.`,
    ).toBe(true);
  });

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
