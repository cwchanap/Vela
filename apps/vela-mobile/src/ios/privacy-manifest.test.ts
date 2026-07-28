import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const iosRoot = resolve(__dirname, '../../src-capacitor/ios/App');
const manifestPath = resolve(iosRoot, 'PrivacyInfo.xcprivacy');
const projectPath = resolve(iosRoot, 'App.xcodeproj/project.pbxproj');
const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
const project = readFileSync(projectPath, 'utf8');

describe('iOS privacy manifest', () => {
  it('ships a privacy manifest with the App target', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(project).toMatch(/PrivacyInfo\.xcprivacy in Resources/u);
  });

  it('declares the approved UserDefaults reason required by Preferences', () => {
    expect(manifest).toMatch(
      /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>NSPrivacyAccessedAPICategoryUserDefaults<\/string>/u,
    );
    expect(manifest).toMatch(
      /<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1<\/string>\s*<\/array>/u,
    );
  });
});
