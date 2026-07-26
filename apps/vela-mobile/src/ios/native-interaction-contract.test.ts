import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const iosRoot = resolve(__dirname, '../../src-capacitor/ios/App');
const swift = readFileSync(resolve(iosRoot, 'App/VelaBridgeViewController.swift'), 'utf8');
const storyboard = readFileSync(resolve(iosRoot, 'App/Base.lproj/Main.storyboard'), 'utf8');
const project = readFileSync(resolve(iosRoot, 'App.xcodeproj/project.pbxproj'), 'utf8');

describe('native interaction bridge contract', () => {
  it('subclasses the Capacitor bridge and enables native gestures', () => {
    expect(swift).toContain('final class VelaBridgeViewController: CAPBridgeViewController');
    expect(swift).toContain('override func capacitorDidLoad()');
    expect(swift).toContain('super.capacitorDidLoad()');
    expect(swift).toContain('webView?.allowsBackForwardNavigationGestures = true');
  });

  it('wires the storyboard to the App target module', () => {
    expect(storyboard).toContain('customClass="VelaBridgeViewController"');
    expect(storyboard).toContain('customModule="App"');
    expect(storyboard).toContain('customModuleProvider="target"');
  });

  it('adds the Swift file to the application Sources phase', () => {
    expect(project).toContain('VelaBridgeViewController.swift');
    expect(project).toContain('VelaBridgeViewController.swift in Sources');
  });
});
