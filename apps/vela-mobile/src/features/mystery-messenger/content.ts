import type { MysteryChapter } from './model';

export const MYSTERY_MESSENGER_VERTICAL_SLICE = {
  id: 'mystery-message-tomorrow-v1',
  version: 1,
  title: '明日からのメッセージ',
  startSceneId: 'scene-01',
  targetPhrases: [],
  scenes: [
    {
      kind: 'message',
      id: 'scene-01',
      speaker: 'mina',
      text: 'こんにちは。これは「あした」からのメッセージです。',
      ttsId: 'mystery-message-tomorrow-v1-scene-01',
      nextSceneId: 'scene-02',
    },
    {
      kind: 'message',
      id: 'scene-02',
      speaker: 'mina',
      text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。遅れないで来てください。',
      ttsId: 'mystery-message-tomorrow-v1-scene-02',
      nextSceneId: 'scene-03',
    },
    {
      kind: 'choice',
      id: 'scene-03',
      speaker: 'mina',
      prompt: 'どう返事をしますか？',
      audioPrompt: {
        ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
        text: 'どう返事をしますか？',
      },
      options: [
        {
          id: 'understood',
          label: 'わかりました',
          result: 'correct',
          feedback: '「わかりました」という短い返事が送られました。',
          nextSceneId: 'scene-04',
        },
        {
          id: 'hesitant',
          label: '少し待って…',
          result: 'incorrect',
          feedback: '少し迷ったけれど、返事を送りました。',
          nextSceneId: 'scene-04',
        },
      ],
      hint: '短い返事で大丈夫です。',
      explanation: '「わかりました」は自然で丁寧な短い返事です。',
      targetPhraseIds: [],
    },
    {
      kind: 'message',
      id: 'scene-04',
      speaker: 'mina',
      text: 'それは約束です。では、また明日の朝7時に。',
      ttsId: 'mystery-message-tomorrow-v1-scene-04',
      nextSceneId: 'scene-05',
    },
    {
      kind: 'ending',
      id: 'scene-05',
      title: 'あしたの約束',
      text: '──あした、朝7時。ノートに新しい言葉が現れ、謎の相手との勉強が始まります。',
      ttsId: 'mystery-message-tomorrow-v1-scene-05',
    },
  ],
} satisfies MysteryChapter;
