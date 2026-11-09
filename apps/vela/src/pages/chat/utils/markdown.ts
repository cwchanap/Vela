import { marked } from 'marked';
import DOMPurify from 'dompurify';

// A dedicated instance keeps the chat hook off the shared DOMPurify
// singleton, so sanitization elsewhere (e.g. the dictionary page) never runs
// chat hooks. Enforce rel="noopener noreferrer" on all links with
// target="_blank" to prevent tabnabbing.
const chatPurify = DOMPurify();

chatPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

marked.setOptions({
  breaks: true,
  gfm: true,
});

// Render markdown with XSS protection
export const renderChatMarkdown = (text: string): string => {
  if (!text) return '';

  try {
    const rawHtml = marked.parse(text) as string;
    // Sanitize HTML to prevent XSS attacks from LLM output
    return chatPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'br',
        'strong',
        'em',
        'u',
        's',
        'del',
        'ul',
        'ol',
        'li',
        'blockquote',
        'code',
        'pre',
        'a',
        'hr',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
    });
  } catch (error) {
    // Log parsing error with context for debugging
    console.error('Failed to parse markdown content:', error, { text });
    // Return escaped text as safe fallback to prevent rendering issues
    return chatPurify.sanitize(text, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      ALLOW_DATA_ATTR: false,
    });
  }
};
