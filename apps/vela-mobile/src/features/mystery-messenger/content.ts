import type { MysteryChapter } from './model';

export const MYSTERY_MESSENGER_VERTICAL_SLICE = {
  id: 'mystery-message-tomorrow-v1',
  title: '明日からのメッセージ',
  scenes: [
    {
      kind: 'message',
      id: 'scene-01',
      text: 'こんにちは。これは「あした」からのメッセージです。',
      ttsId: 'mystery-message-tomorrow-v1-scene-01',
      nextSceneId: 'scene-02',
    },
    {
      kind: 'message',
      id: 'scene-02',
      text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。遅れないで来てください。',
      ttsId: 'mystery-message-tomorrow-v1-scene-02',
      nextSceneId: 'scene-03',
    },
    {
      kind: 'choice',
      id: 'scene-03',
      prompt: 'どう返事をしますか？',
      ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
      options: [
        {
          id: 'understood',
          label: 'わかりました',
          feedback: '「わかりました」という短い返事が送られました。',
          nextSceneId: 'scene-04',
        },
        {
          id: 'hesitant',
          label: '少し待って…',
          feedback: '少し迷ったけれど、返事を送りました。',
          nextSceneId: 'scene-04',
        },
      ],
    },
    {
      kind: 'message',
      id: 'scene-04',
      text: 'それは約束です。では、また明日の朝7時に。',
      ttsId: 'mystery-message-tomorrow-v1-scene-04',
      nextSceneId: 'scene-05',
    },
    {
      kind: 'ending',
      id: 'scene-05',
      text: '──あした、朝7時。ノートに新しい言葉が現れ、謎の相手との勉強が始まります。',
      ttsId: 'mystery-message-tomorrow-v1-scene-05',
    },
  ],
} satisfies MysteryChapter;
