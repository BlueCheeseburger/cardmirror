import { describe, expect, it } from 'vitest';
import { detectLinkHref } from '../../src/editor/link-context-menu-plugin.js';

describe('detectLinkHref', () => {
  it('recognizes an https URL as-is', () => {
    expect(detectLinkHref('https://www.healthcare.digital/single-post/the-asymmetry')).toBe(
      'https://www.healthcare.digital/single-post/the-asymmetry',
    );
  });

  it('recognizes an http URL as-is', () => {
    expect(detectLinkHref('http://example.com')).toBe('http://example.com');
  });

  it('prepends https:// to a www.-prefixed domain', () => {
    expect(detectLinkHref('www.example.com/page')).toBe('https://www.example.com/page');
  });

  it('prepends https:// to a bare domain with a known TLD', () => {
    expect(detectLinkHref('example.com/page')).toBe('https://example.com/page');
    expect(detectLinkHref('example.org')).toBe('https://example.org');
  });

  it('trims surrounding whitespace before detecting', () => {
    expect(detectLinkHref('  example.com  ')).toBe('https://example.com');
  });

  it('rejects ordinary text containing a dot', () => {
    expect(detectLinkHref('e.g.')).toBeNull();
    expect(detectLinkHref('Verbatim.docx')).toBeNull();
    expect(detectLinkHref('Dr. Smith')).toBeNull();
  });

  it('rejects text with spaces', () => {
    expect(detectLinkHref('this is not a link.com really')).toBeNull();
  });

  it('rejects plain words and empty input', () => {
    expect(detectLinkHref('hyperlink')).toBeNull();
    expect(detectLinkHref('')).toBeNull();
    expect(detectLinkHref('   ')).toBeNull();
  });
});
