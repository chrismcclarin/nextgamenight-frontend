/**
 * CodeQL `js/xss-through-dom` (first scan, 2026-09-08) — `SafeImage` rendered
 * `<img src={src}>` with no scheme check. `src` is untrusted on every call site:
 * BGG `image_url`/`thumbnail_url` and group `profile_picture_url`, the latter an
 * arbitrary user-pasted string.
 *
 * These tests pin the guard AND the thing the guard must not break. The
 * rejection cases are the security half; the acceptance cases are the
 * regression half, and they are load-bearing in the other direction — six call
 * sites admit root-relative values via
 * `value.startsWith('http') || value.startsWith('/')`, so a guard that mirrored
 * `safeBgImageStyle`'s reject-relative default would silently flip every group
 * profile picture to the placeholder. Both halves have to stay.
 *
 * NOTE on querying: the fallback branch is a <div role="img">, so
 * `getByRole('img')` matches BOTH branches and cannot tell them apart. Every
 * assertion about the real element therefore goes through
 * `container.querySelector('img')` — the tag, not the role.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import SafeImage from './SafeImage';

// Untyped JS component: spread a typed-any bag so JSX does not demand props
// it only destructures at runtime.
const anyProps = (p: Record<string, unknown>): any => p;

afterEach(cleanup);

describe('SafeImage protocol allow-list (CodeQL js/xss-through-dom)', () => {
  describe('allowed schemes render a real <img>', () => {
    it('renders an <img> for an https: src', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: 'https://example.com/pic.png', alt: 'A game' })} />
      );

      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', 'https://example.com/pic.png');
      expect(img).toHaveAttribute('alt', 'A game');
    });

    it('renders an <img> for an http: src', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: 'http://example.com/pic.png', alt: 'A game' })} />
      );

      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'http://example.com/pic.png'
      );
    });

    // The real value shape from the BGG import path (game.image_url /
    // game.thumbnail_url) — CalendarListView, GroupLibrary, GroupGamesList,
    // GameSuggestionCard, BringGamePicker, userProfile, gameDetail.
    it('renders an <img> for a real BGG image URL', () => {
      const bgg =
        'https://cf.geekdo-images.com/originalimages/img/abc123/original.jpg';
      const { container } = render(
        <SafeImage {...anyProps({ src: bgg, alt: 'Gloomhaven' })} />
      );

      expect(container.querySelector('img')).toHaveAttribute('src', bgg);
    });

    // The helper is called with `allowRelative: true` precisely so this keeps
    // working: six call sites gate on `startsWith('/')`.
    it('renders an <img> for a root-relative src (six call sites admit these)', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: '/uploads/group-pic.png', alt: 'Group' })} />
      );

      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      // Passed through UNCHANGED — it must still resolve against the real page
      // origin, not the throwaway validation base.
      expect(img).toHaveAttribute('src', '/uploads/group-pic.png');
    });

    it('does not rewrite the src it was given', () => {
      const withQuery = 'https://example.com/pic.png?w=64&h=64';
      const { container } = render(
        <SafeImage {...anyProps({ src: withQuery, alt: 'x' })} />
      );

      expect(container.querySelector('img')).toHaveAttribute('src', withQuery);
    });
  });

  describe('disallowed schemes render the fallback and NO <img>', () => {
    // The finding itself.
    it('renders the fallback for a javascript: src', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: 'javascript:alert(1)', alt: 'Evil' })} />
      );

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'Evil' })).toBeInTheDocument();
    });

    // Browsers normalise these back to `javascript:` before dispatch, and so
    // does the WHATWG URL parser the guard uses — the two agree, which is the
    // whole reason the guard parses instead of string-matching.
    it.each([
      ['mixed case', 'JaVaScRiPt:alert(1)'],
      ['leading whitespace', '   javascript:alert(1)'],
      ['embedded newline', 'java\nscript:alert(1)'],
      ['embedded tab', 'java\tscript:alert(1)'],
    ])('renders the fallback for an obfuscated javascript: src (%s)', (_label, src) => {
      const { container } = render(<SafeImage {...anyProps({ src, alt: 'Evil' })} />);

      expect(container.querySelector('img')).toBeNull();
    });

    it.each([
      ['data:image', 'data:image/png;base64,iVBORw0KGgo='],
      ['data:text/html', 'data:text/html,<script>alert(1)</script>'],
      ['vbscript:', 'vbscript:msgbox(1)'],
      ['blob:', 'blob:https://example.com/9b1deb4d'],
      ['file:', 'file:///etc/passwd'],
    ])('renders the fallback for a %s src', (_label, src) => {
      const { container } = render(<SafeImage {...anyProps({ src, alt: 'Evil' })} />);

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'Evil' })).toBeInTheDocument();
    });
  });

  describe('pre-existing fallback behaviour is preserved', () => {
    it('renders the fallback when src is missing', () => {
      const { container } = render(<SafeImage {...anyProps({ alt: 'No source' })} />);

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'No source' })).toBeInTheDocument();
    });

    it('renders the fallback when src is an empty string', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: '', alt: 'Empty' })} />
      );

      expect(container.querySelector('img')).toBeNull();
    });

    it('still swaps to the fallback on a load error from an allowed src', () => {
      const { container } = render(
        <SafeImage {...anyProps({ src: 'https://example.com/404.png', alt: 'Broken' })} />
      );

      const img = container.querySelector('img');
      expect(img).not.toBeNull();

      fireEvent.error(img as HTMLImageElement);

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'Broken' })).toBeInTheDocument();
    });

    it('renders the custom fallbackIcon when the scheme is rejected', () => {
      render(
        <SafeImage
          {...anyProps({ src: 'javascript:alert(1)', alt: 'Group', fallbackIcon: '\u{1F465}' })}
        />
      );

      expect(screen.getByText('\u{1F465}')).toBeInTheDocument();
    });

    it('labels the fallback generically when alt is absent', () => {
      render(<SafeImage {...anyProps({ src: 'javascript:alert(1)' })} />);

      expect(screen.getByRole('img', { name: 'Image placeholder' })).toBeInTheDocument();
    });
  });
});
