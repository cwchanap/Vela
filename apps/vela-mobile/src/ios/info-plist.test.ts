import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MOBILE_OAUTH_CALLBACK_URI } from '../auth/mobile-auth-contract';

// The Xcode project wires the build configurations to separate plists:
//   Debug   → Info-Debug.plist (carries the NSAppTransportSecurity exception
//                              for LAN HTTP dev on physical devices)
//   Release → Info.plist       (no ATS exception — Release must not allow HTTP)
// Both files must be exercised: a Capacitor sync could wipe entries in either.
// See apps/vela-mobile/src-capacitor/ios/App/App.xcodeproj/project.pbxproj
// (INFOPLIST_FILE = App/Info-Debug.plist for Debug, App/Info.plist for Release).
const plistDir = resolve(__dirname, '../../src-capacitor/ios/App/App');
const releasePlistPath = resolve(plistDir, 'Info.plist');
const debugPlistPath = resolve(plistDir, 'Info-Debug.plist');
const releaseContent = readFileSync(releasePlistPath, 'utf8');
const debugContent = readFileSync(debugPlistPath, 'utf8');

// Binary plists start with `bplist00`. Xcode occasionally converts Info.plist
// to binary format (e.g. after a merge conflict resolution or an Xcode
// version upgrade). The regex-based extractors below return null/empty on
// binary plists, which would surface as misleading "Capacitor sync wiped
// CFBundleURLTypes" failures. Wrapped in a test() so a binary plist surfaces
// as a named per-test failure with a clear remediation message, instead of a
// module-load error that obscures which test file failed.
function isBinaryPlist(xml: string): boolean {
  return xml.startsWith('bplist');
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
// sibling keys (CFBundleURLName, CFBundleURLTypeRole) that Capacitor syncs have
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

// Both plists carry the same CFBundleURLTypes entry (the OAuth scheme is
// required in both Debug and Release). Run the shared assertions against each
// file so a Capacitor sync wiping the entry in either build surfaces as a
// named failure.
function describeSharedPlistAssertions(label: string, path: string, content: string): void {
  describe(`${label} (shared)`, () => {
    test('is XML, not binary', () => {
      // Fail fast with a clear remediation message before the regex-based
      // assertions below would produce misleading "Capacitor sync wiped
      // CFBundleURLTypes" failures on a binary plist.
      expect(
        !isBinaryPlist(content),
        `${path} is a binary plist. Convert it back to XML: plutil -convert xml1 "${path}". The Info.plist test assumes XML text.`,
      ).toBe(true);
    });

    test('registers the custom URL scheme used by the OAuth callback URI', () => {
      const schemes = extractSchemes(content);
      const callbackScheme = new URL(MOBILE_OAUTH_CALLBACK_URI).protocol.replace(/:$/u, '');
      expect(schemes).toContain(callbackScheme);
    });

    test('CFBundleURLTypes entry declares CFBundleURLName and CFBundleTypeRole', () => {
      const entry = extractUrlTypeEntry(content);
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
}

describe('iOS Info.plist', () => {
  describeSharedPlistAssertions('Info.plist (Release)', releasePlistPath, releaseContent);
  describeSharedPlistAssertions('Info-Debug.plist (Debug)', debugPlistPath, debugContent);

  // Physical-device development points the Capacitor app at the dev Mac's LAN
  // IP over plain HTTP (see apps/vela-mobile/.env.example). ATS blocks HTTP by
  // default, so the Debug plist must carry a narrowly scoped exception.
  // NSAllowsLocalNetworking permits HTTP to local network resources (private
  // IP addresses, .local, .localdomain) without opening up arbitrary HTTP to
  // the internet — broader exceptions (NSAllowsArbitraryLoads) would require
  // App Store justification and are intentionally absent.
  describe('Info-Debug.plist ATS exception (Debug-only)', () => {
    test('declares a narrowly scoped NSAppTransportSecurity exception for local networking', () => {
      const hasKey = /<key>NSAppTransportSecurity<\/key>\s*<dict>/.test(debugContent);
      expect(
        hasKey,
        'NSAppTransportSecurity missing from Info-Debug.plist — physical-device HTTP dev to a LAN IP is blocked by ATS',
      ).toBe(true);

      const allowsLocalNetworking = /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/.test(
        debugContent,
      );
      expect(
        allowsLocalNetworking,
        'Info-Debug.plist NSAppTransportSecurity must set NSAllowsLocalNetworking=true for LAN HTTP dev',
      ).toBe(true);

      const allowsArbitraryLoads = /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(
        debugContent,
      );
      expect(
        allowsArbitraryLoads,
        'NSAllowsArbitraryLoads=true is too broad — use NSAllowsLocalNetworking for dev-only LAN HTTP',
      ).toBe(false);
    });

    // ATS (NSAllowsLocalNetworking) and iOS Local Network Privacy are
    // separate mechanisms. The Debug build connects directly to the dev Mac's
    // LAN IP for both the API (http://<lan-ip>:9005/api/) and Capacitor
    // live-reload (http://<lan-ip>:9100) — both are local-network operations
    // under iOS 14+, which requires NSLocalNetworkUsageDescription to supply
    // the user-facing explanation shown in the Local Network permission prompt.
    // Without it the prompt still appears (or the connection is blocked until
    // granted) but with a generic message, and App Store Connect flags the
    // missing key. NSAllowsLocalNetworking only relaxes the HTTPS requirement;
    // it does not grant Local Network privacy permission.
    test('declares NSLocalNetworkUsageDescription for direct LAN host access', () => {
      const hasKey = /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(
        debugContent,
      );
      expect(
        hasKey,
        'NSLocalNetworkUsageDescription missing from Info-Debug.plist — physical-device dev connects directly to the Mac LAN IP, which is a local-network operation under iOS 14+ and requires a user-facing explanation string separate from the ATS exception.',
      ).toBe(true);
    });
  });

  // The Release plist must NOT carry an ATS exception. The runtime
  // validateConfig() rejects http: in production, so a Release build should
  // never need one; a leaked NSAppTransportSecurity entry in Release would
  // signal that the build configuration split (project.pbxproj
  // INFOPLIST_FILE) has been undone or that an exception was added by mistake.
  describe('Info.plist ATS absence (Release)', () => {
    test('does not declare NSAppTransportSecurity', () => {
      const hasKey = /<key>NSAppTransportSecurity<\/key>/.test(releaseContent);
      expect(
        hasKey,
        'NSAppTransportSecurity present in Release Info.plist — Release builds must not carry an ATS exception. The Debug-only exception lives in Info-Debug.plist.',
      ).toBe(false);
    });

    test('does not declare NSAllowsLocalNetworking', () => {
      const hasKey = /<key>NSAllowsLocalNetworking<\/key>/.test(releaseContent);
      expect(
        hasKey,
        'NSAllowsLocalNetworking present in Release Info.plist — this Debug-only exception must not leak into Release.',
      ).toBe(false);
    });

    test('does not declare NSAllowsArbitraryLoads', () => {
      const hasKey = /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(releaseContent);
      expect(hasKey, 'NSAllowsArbitraryLoads=true is too broad for any build configuration.').toBe(
        false,
      );
    });

    // Release builds target https://vela.cwchanap.dev/api/ (production), not a
    // LAN host, so they perform no local-network operations and must not
    // carry the Debug-only NSLocalNetworkUsageDescription. A leaked key would
    // signal the Debug/Release plist split has been undone, and would surface
    // an unnecessary permission prompt in App Store builds.
    test('does not declare NSLocalNetworkUsageDescription', () => {
      const hasKey = /<key>NSLocalNetworkUsageDescription<\/key>/.test(releaseContent);
      expect(
        hasKey,
        'NSLocalNetworkUsageDescription present in Release Info.plist — this Debug-only key must not leak into Release. Release builds target the production HTTPS API and perform no local-network operations.',
      ).toBe(false);
    });
  });
});
