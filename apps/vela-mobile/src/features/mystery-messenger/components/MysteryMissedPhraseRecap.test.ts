import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { describe, expect, it } from 'vitest';
import type { MysteryMissedPhraseRecapItem } from '../model';
import MysteryMissedPhraseRecap from './MysteryMissedPhraseRecap.vue';

const ITEM: MysteryMissedPhraseRecapItem = {
  phraseId: 'tomorrow-seven',
  text: 'あしたの朝7時',
  reading: 'あしたのあさしちじ',
  meaning: 'tomorrow at 7 a.m.',
  sourcePrompt: 'ミナさんは、いつ駅に来てほしいですか？',
};

const SECOND_ITEM: MysteryMissedPhraseRecapItem = {
  phraseId: 'mina-possession',
  text: 'ミナさんのです',
  reading: 'ミナさんのです',
  meaning: "it is Mina's",
  sourcePrompt: 'これは、だれのノートですか？',
};

type PlaybackKind = 'preparing' | 'ready' | 'playing' | 'error';

function mountRecap(
  items: readonly MysteryMissedPhraseRecapItem[] = [],
  playback: { activePhraseId?: string; playbackKind?: PlaybackKind; playbackError?: string } = {},
) {
  return mount(MysteryMissedPhraseRecap, {
    props: { items, ...playback },
    global: { plugins: [Quasar] },
  });
}

describe('MysteryMissedPhraseRecap', () => {
  it('renders the exact empty copy when no phrases were missed', () => {
    const wrapper = mountRecap([]);

    expect(wrapper.get('[data-testid="mystery-recap"]').text()).toBe('No missed phrases this run.');
    expect(wrapper.findAll('[data-testid^="mystery-recap-phrase-"]')).toHaveLength(0);
  });

  it('renders each recap row exactly once', () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM]);

    expect(wrapper.findAll('[data-testid="mystery-recap-phrase-tomorrow-seven"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="mystery-recap-phrase-mina-possession"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="mystery-recap"]').text()).not.toContain(
      'No missed phrases this run.',
    );
  });

  it('renders phrase Japanese with lang=ja and the meaning in English', () => {
    const wrapper = mountRecap([ITEM]);

    const row = wrapper.get('[data-testid="mystery-recap-phrase-tomorrow-seven"]');
    const text = wrapper.get('[data-testid="mystery-recap-text-tomorrow-seven"]');
    const reading = wrapper.get('[data-testid="mystery-recap-reading-tomorrow-seven"]');
    const meaning = wrapper.get('[data-testid="mystery-recap-meaning-tomorrow-seven"]');
    const prompt = wrapper.get('[data-testid="mystery-recap-prompt-tomorrow-seven"]');

    expect(text.text()).toBe('あしたの朝7時');
    expect(text.attributes('lang')).toBe('ja');
    expect(reading.text()).toBe('あしたのあさしちじ');
    expect(reading.attributes('lang')).toBe('ja');
    expect(meaning.text()).toBe('tomorrow at 7 a.m.');
    expect(meaning.attributes('lang')).toBeUndefined();
    expect(prompt.text()).toBe('ミナさんは、いつ駅に来てほしいですか？');
    expect(prompt.attributes('lang')).toBe('ja');

    // Phrase rows and any text may never carry a From: label
    expect(wrapper.text()).not.toContain('From:');
    expect(row.text()).not.toContain('From:');
  });

  it('emits replay with the phrase id', async () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM]);

    await wrapper.get('[data-testid="mystery-recap-replay-tomorrow-seven"]').trigger('click');
    await wrapper.get('[data-testid="mystery-recap-replay-mina-possession"]').trigger('click');

    expect(wrapper.emitted('replay')).toEqual([['tomorrow-seven'], ['mina-possession']]);
  });

  it('marks only the active row while audio prepares', () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM], {
      activePhraseId: 'tomorrow-seven',
      playbackKind: 'preparing',
    });

    const status = wrapper.get('[data-testid="mystery-recap-status-tomorrow-seven"]');
    expect(status.text()).toBe('Preparing audio…');
    expect(status.attributes('role')).toBe('status');
    expect(wrapper.find('[data-testid="mystery-recap-status-mina-possession"]').exists()).toBe(
      false,
    );
  });

  it('tells the active row to tap Replay again once audio is ready', () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM], {
      activePhraseId: 'tomorrow-seven',
      playbackKind: 'ready',
    });

    const status = wrapper.get('[data-testid="mystery-recap-status-tomorrow-seven"]');
    expect(status.text()).toBe('Tap Replay again');
    expect(status.attributes('role')).toBe('status');
    expect(wrapper.find('[data-testid="mystery-recap-status-mina-possession"]').exists()).toBe(
      false,
    );
  });

  it('marks the active row while audio plays', () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM], {
      activePhraseId: 'tomorrow-seven',
      playbackKind: 'playing',
    });

    const status = wrapper.get('[data-testid="mystery-recap-status-tomorrow-seven"]');
    expect(status.text()).toBe('Playing audio…');
    expect(status.attributes('role')).toBe('status');
    expect(wrapper.find('[data-testid="mystery-recap-status-mina-possession"]').exists()).toBe(
      false,
    );
  });

  it('alerts the active row when its audio fails', () => {
    const wrapper = mountRecap([ITEM, SECOND_ITEM], {
      activePhraseId: 'tomorrow-seven',
      playbackKind: 'error',
      playbackError: 'audio_sentinel_failure',
    });

    const status = wrapper.get('[data-testid="mystery-recap-status-tomorrow-seven"]');
    expect(status.text()).toBe('Audio playback failed: audio_sentinel_failure');
    expect(status.attributes('role')).toBe('alert');
    expect(wrapper.find('[data-testid="mystery-recap-status-mina-possession"]').exists()).toBe(
      false,
    );
  });

  it('renders no row status when no phrase is active', () => {
    const wrapper = mountRecap([ITEM], { playbackKind: 'playing' });

    expect(wrapper.find('[data-testid="mystery-recap-status-tomorrow-seven"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('Playing audio…');
  });
});
