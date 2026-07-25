import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Parse the plists as XML without adding a runtime dependency.
// The files are small and stable; regexes on the raw text are enough to catch
// Capacitor/Xcode changes that remove required entries or widen ATS policy.
const releasePlistPath = resolve(__dirname, '../../src-capacitor/ios/App/App/Info.plist');
const releasePlistContent = readFileSync(releasePlistPath, 'utf8');
const debugPlistPath = resolve(__dirname, '../../src-capacitor/ios/App/App/Info-Debug.plist');
const debugPlistContent = readFileSync(debugPlistPath, 'utf8');

function isBinaryPlist(content: string): boolean {
  return content.startsWith('bplist');
}

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
// any sibling keys appended after it.
function extractUrlTypeEntry(xml: string): string | null {
  const keyIdx = xml.indexOf('<key>CFBundleURLTypes</key>');
  if (keyIdx === -1) return null;
  const afterKey = xml.slice(keyIdx);
  const arrayOpen = afterKey.match(/\s*<array>/);
  if (!arrayOpen || arrayOpen.index === undefined) return null;
  const start = keyIdx + arrayOpen.index + arrayOpen[0].length;

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
  const match = xml.match(re);
  return match && match[1] !== undefined ? match[1] : null;
}

function allowsLocalNetworking(xml: string): boolean {
  return /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/.test(xml);
}

function allowsArbitraryLoads(xml: string): boolean {
  return /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(xml);
}

describe('iOS Info.plist', () => {
  test('Release Info.plist is XML, not binary', () => {
    expect(
      !isBinaryPlist(releasePlistContent),
      `${releasePlistPath} is a binary plist. Convert it back to XML: plutil -convert xml1 "${releasePlistPath}". The Info.plist test assumes XML text.`,
    ).toBe(true);
  });

  test('Debug Info-Debug.plist is XML, not binary', () => {
    expect(
      !isBinaryPlist(debugPlistContent),
      `${debugPlistPath} is a binary plist. Convert it back to XML: plutil -convert xml1 "${debugPlistPath}". The Info.plist test assumes XML text.`,
    ).toBe(true);
  });

  test('registers the dev.cwchanap.vela.oauth custom URL scheme', () => {
    const schemes = extractSchemes(releasePlistContent);
    expect(schemes).toContain('dev.cwchanap.vela.oauth');
  });

  test('CFBundleURLTypes entry declares CFBundleURLName and CFBundleTypeRole', () => {
    const entry = extractUrlTypeEntry(releasePlistContent);
    expect(
      entry,
      'CFBundleURLTypes dict entry missing — Capacitor sync may have wiped it',
    ).not.toBeNull();
    if (!entry) return;

    const urlName = extractKeyValue(entry, 'CFBundleURLName');
    const typeRole = extractKeyValue(entry, 'CFBundleTypeRole');

    expect(urlName, 'CFBundleURLName missing inside CFBundleURLTypes dict').not.toBeNull();
    expect(typeRole, 'CFBundleTypeRole missing inside CFBundleURLTypes dict').not.toBeNull();
    expect(typeRole).toBe('Editor');
  });

  test('Debug plist allows local networking without arbitrary HTTP loads', () => {
    expect(
      allowsLocalNetworking(debugPlistContent),
      'Debug Info-Debug.plist must set NSAllowsLocalNetworking=true for LAN HTTP development',
    ).toBe(true);
    expect(
      allowsArbitraryLoads(debugPlistContent),
      'NSAllowsArbitraryLoads=true is too broad — use NSAllowsLocalNetworking for Debug builds',
    ).toBe(false);
  });

  test('Release plist does not include an ATS exception', () => {
    expect(
      allowsLocalNetworking(releasePlistContent),
      'Release Info.plist must not allow local HTTP networking',
    ).toBe(false);
    expect(
      allowsArbitraryLoads(releasePlistContent),
      'Release Info.plist must not allow arbitrary HTTP loads',
    ).toBe(false);
  });
});
