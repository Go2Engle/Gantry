import { marked } from 'marked';

const BLOCKED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

export function renderMarkdown(markdown: string, rawImageBaseUrl?: string): string {
  const html = marked.parse(markdown) as string;
  return sanitizeHtml(rewriteRelativeImageSources(html, rawImageBaseUrl));
}

function rewriteRelativeImageSources(html: string, rawImageBaseUrl?: string): string {
  if (!rawImageBaseUrl || typeof DOMParser === 'undefined') {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (!src || isAbsoluteOrSpecialURL(src)) return;
    const normalized = src.replace(/^\.\//, '');
    img.setAttribute('src', rawImageBaseUrl + normalized.split('/').map(encodeURIComponent).join('/'));
  });
  return doc.body.innerHTML;
}

function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return '';
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('*').forEach((el) => {
    if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      return;
    }

    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
        el.removeAttribute(attr.name);
        return;
      }
      if (URL_ATTRS.has(name) && isUnsafeURL(value)) {
        el.removeAttribute(attr.name);
      }
    });

    if (el.tagName.toLowerCase() === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return doc.body.innerHTML;
}

function isAbsoluteOrSpecialURL(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function isUnsafeURL(value: string): boolean {
  const compact = value.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  if (compact.startsWith('javascript:')) {
    return true;
  }
  if (!compact.startsWith('data:')) {
    return false;
  }
  const mediaType = compact.slice(5).split(/[;,]/, 1)[0];
  return mediaType === 'text/html' ||
    mediaType === 'text/xml' ||
    mediaType === 'image/svg+xml' ||
    mediaType.endsWith('+xml');
}
