import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ChatMessageList from './ChatMessageList.vue';
import type { ChatMessage } from '../../../stores/chat';

const message = (type: 'user' | 'ai', content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  type,
  content,
  timestamp: new Date(),
});

describe('ChatMessageList markdown sanitization', () => {
  const mountComponent = (messages: ChatMessage[]) =>
    mount(ChatMessageList, {
      props: { messages, isTyping: false },
      global: { plugins: [Quasar] },
    });

  const renderedHtml = (wrapper: ReturnType<typeof mountComponent>) =>
    wrapper.find('.markdown-content').element.innerHTML;

  it('strips inline event handlers from injected HTML', () => {
    const wrapper = mountComponent([
      message('ai', '<img src="x" onerror="alert(1)"><b onmouseover="alert(2)">hi</b>'),
    ]);

    const html = renderedHtml(wrapper);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('alert(');
  });

  it('strips script tags and keeps their text inert', () => {
    const wrapper = mountComponent([message('ai', 'before<script>alert(1)</script>after')]);

    const html = renderedHtml(wrapper);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(wrapper.find('.markdown-content').element.querySelector('script')).toBeNull();
  });

  it('strips javascript: URLs from markdown links', () => {
    const wrapper = mountComponent([message('ai', '[click me](javascript:alert(1))')]);

    const html = renderedHtml(wrapper);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from raw HTML anchors', () => {
    const wrapper = mountComponent([
      message('ai', '<a href="javascript:alert(1)" target="_blank">click</a>'),
    ]);

    const html = renderedHtml(wrapper);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('strips data: URLs and disallowed embeds', () => {
    const wrapper = mountComponent([
      message(
        'ai',
        '[payload](data:text/html;base64,PHNjcmlwdD4=)<iframe src="https://evil.example"></iframe>',
      ),
    ]);

    const html = renderedHtml(wrapper);
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('<iframe');
  });

  it('keeps legitimate markdown formatting intact', () => {
    const wrapper = mountComponent([
      message(
        'ai',
        '# Title\n\n**bold** and *emphasis* with `code`\n\n- first\n- second\n\n[safe link](https://example.com)',
      ),
    ]);

    const html = renderedHtml(wrapper);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('adds rel="noopener noreferrer" to target-blank links', () => {
    const wrapper = mountComponent([
      message('ai', '<a href="https://example.com" target="_blank">external</a>'),
    ]);

    const link = wrapper.find('.markdown-content a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('keeps the chat sanitizer hook off the shared DOMPurify instance', async () => {
    const DOMPurify = (await import('dompurify')).default;
    const html = DOMPurify.sanitize('<a href="https://example.com" target="_blank">external</a>');
    expect(html).not.toContain('noopener');
  });

  it('does not render user messages as markdown', () => {
    const wrapper = mountComponent([message('user', '**not bold** <img src="x" onerror="a()">')]);

    const userContent = wrapper.find('.user-message .message-content');
    expect(userContent.text()).toBe('**not bold** <img src="x" onerror="a()">');
    expect(userContent.element.innerHTML).not.toContain('<strong>');
    expect(userContent.element.innerHTML).not.toContain('<img');
  });
});
