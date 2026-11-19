// Plan 88.9-60, X6 (owner F1): the shared picture-load probe. A group picture is a CSS
// background-image, which reports nothing when it fails to load, so the probe is the only signal
// that lets a dead picture take the no-picture treatment. These tests drive the probe through a
// fake image constructor (src/test-utils/pictureProbe.ts ("export function installFakeImage(")): a URL
// holding the word fail errors, any other URL loads, and nothing settles until the test says so.
import { createElement, useEffect, useLayoutEffect, type CSSProperties, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bgImageProbeForTests, useBgImageFailed } from './useBgImageFailed';
import { safeBgImageStyle } from '../safeBgImageStyle';
import { installFakeImage, type FakeImageControl } from '@/test-utils/pictureProbe';

const OK_URL = 'https://example.test/photo.png';
const OTHER_OK_URL = 'https://example.test/other.png';
const FAIL_URL = 'https://example.test/fail-photo.png';
const OTHER_FAIL_URL = 'https://example.test/fail-other.png';

const styleFor = (url: string): CSSProperties => safeBgImageStyle(url) as CSSProperties;
const hrefFor = (url: string): string => new URL(url).href;

interface ConsumerProps {
  id: string;
  style: CSSProperties | undefined;
  /** One entry per render: what the probe answered. */
  log?: boolean[];
}

/** Shows which arm a surface would paint: the photo arm, or the plain (no-picture) arm. */
function Consumer({ id, style, log }: ConsumerProps): ReactElement {
  const bgImageFailed = useBgImageFailed();
  const failed = bgImageFailed(style);
  log?.push(failed);
  return createElement('span', { 'data-testid': id }, failed ? 'plain' : 'photo');
}

const consumer = (props: ConsumerProps): ReactElement => createElement(Consumer, { key: props.id, ...props });
const arm = (id: string): string | null => screen.getByTestId(id).textContent;

let images: FakeImageControl;

beforeEach(() => {
  bgImageProbeForTests.reset();
  images = installFakeImage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  bgImageProbeForTests.reset();
});

describe('useBgImageFailed — the shared picture-load probe (88.9-60 X6)', () => {
  it('X6 (88.9): a pending or loaded picture reads not failed, so the photo arm renders first', () => {
    const log: boolean[] = [];
    render(consumer({ id: 'a', style: styleFor(OK_URL), log }));

    // Pending: the probe exists and has not settled.
    expect(images.srcs(), 'the picture was never probed').toEqual([hrefFor(OK_URL)]);
    expect(log[0], 'the FIRST render did not paint the photo arm').toBe(false);
    expect(arm('a')).toBe('photo');

    const rendersWhilePending = log.length;
    act(() => images.settleAll());
    expect(arm('a'), 'a picture that LOADED left the photo arm').toBe('photo');
    expect(log.length, 'a successful load re-rendered the consumer').toBe(rendersWhilePending);
    expect(log.every((failed) => failed === false)).toBe(true);
  });

  it('X6 (88.9): a probe error reads failed and re-renders the consumer', () => {
    const log: boolean[] = [];
    render(consumer({ id: 'a', style: styleFor(FAIL_URL), log }));
    expect(arm('a'), 'the photo arm did not paint while the picture was pending').toBe('photo');

    act(() => images.settleAll());
    expect(arm('a'), 'a picture that failed to load kept the photo arm').toBe('plain');
    expect(log[0]).toBe(false);
    expect(log[log.length - 1]).toBe(true);
    expect(images.liveHandlers(), 'a settled probe still holds a handler').toBe(0);
  });

  it('X6 (88.9): one probe per URL, and a later mount reads a cached failure on first render', () => {
    const first = render(
      createElement('div', null, consumer({ id: 'a', style: styleFor(FAIL_URL) }), consumer({ id: 'b', style: styleFor(FAIL_URL) })),
    );
    expect(images.srcs(), 'two consumers of one URL started two probes').toEqual([hrefFor(FAIL_URL)]);

    act(() => images.settleAll());
    expect(arm('a')).toBe('plain');
    expect(arm('b')).toBe('plain');
    first.unmount();

    const log: boolean[] = [];
    render(consumer({ id: 'late', style: styleFor(FAIL_URL), log }));
    expect(log[0], 'a later mount did not read the cached failure on its FIRST render').toBe(true);
    expect(arm('late')).toBe('plain');
    expect(images.srcs(), 'a settled URL was probed a second time').toEqual([hrefFor(FAIL_URL)]);
  });

  it('X6 (88.9): no style or a non-allow-listed URL is never probed', () => {
    const rejected: (CSSProperties | undefined)[] = [
      undefined,
      {},
      { backgroundImage: 'url("javascript:alert(1)")' },
      { backgroundImage: 'url("data:image/png;base64,AAAA")' },
      { backgroundImage: 'url("/uploads/fail.png")' },
      { backgroundImage: 'linear-gradient(red, blue)' },
      // Not the validated shape: unquoted, so it never came from the validator.
      { backgroundImage: `url(${FAIL_URL})` },
    ];
    render(createElement('div', null, ...rejected.map((style, i) => consumer({ id: `r${i}`, style }))));
    act(() => images.settleAll());

    expect(images.srcs(), 'a rejected or absent picture was probed').toEqual([]);
    rejected.forEach((_, i) => expect(arm(`r${i}`), `case ${i} read failed`).toBe('photo'));
  });

  it('X6 (88.9): a server render reads not failed and constructs no Image', async () => {
    // A cached failure on the client first, so "not failed" below is the server snapshot's answer
    // and not merely an empty store.
    const warm = render(consumer({ id: 'warm', style: styleFor(FAIL_URL) }));
    act(() => images.settleAll());
    expect(arm('warm')).toBe('plain');
    warm.unmount();
    const probedBefore = images.srcs().length;
    const realWindow = window;

    // (a) This module, with the window taken away: the constant server snapshot answers, nothing
    // is probed, and nothing is queued for a later client drain. The module was loaded WITH a
    // window, so its layout effect is the client one and React's server warning is expected here.
    const swallowed = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    let html = '';
    try {
      html =
        renderToString(consumer({ id: 's1', style: styleFor(FAIL_URL) })) +
        renderToString(consumer({ id: 's2', style: styleFor(OTHER_FAIL_URL) }));
    } finally {
      vi.stubGlobal('window', realWindow);
    }
    swallowed.mockRestore();
    expect(html, 'the server render read a failure').not.toContain('plain');
    expect(html.match(/photo/g)?.length).toBe(2);
    expect(images.srcs().length, 'the server render constructed an Image').toBe(probedBefore);

    // Back on the client: a consumer of a THIRD url drains the queue. Had the server render
    // written its lookup into the queue, the unprobed url would be probed now.
    render(consumer({ id: 'client', style: styleFor(OK_URL) }));
    expect(images.srcs(), 'a lookup made without a window was queued and probed later').not.toContain(hrefFor(OTHER_FAIL_URL));

    // (b) A module instance loaded WITHOUT a window, as on the server: its publish effect is a
    // plain effect, so the render logs nothing (a bare layout effect logs React 18's warning).
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const react = await import('react');
      const server = await import('react-dom/server');
      const fresh = await import('./useBgImageFailed');
      function ServerConsumer(): ReactElement {
        const bgImageFailed = fresh.useBgImageFailed();
        return react.createElement('span', null, bgImageFailed(styleFor(FAIL_URL)) ? 'plain' : 'photo');
      }
      expect(server.renderToString(react.createElement(ServerConsumer))).toBe('<span>photo</span>');
      expect(errors.mock.calls, 'the server render logged an error (a bare layout effect warns on the server)').toEqual([]);
    } finally {
      vi.stubGlobal('window', realWindow);
      vi.resetModules();
    }
    expect(images.srcs().length, 'the server-loaded module constructed an Image').toBe(probedBefore + 1);
  });

  it('X6 (88.9): unmount before settle leaves no listener and throws nothing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(consumer({ id: 'a', style: styleFor(FAIL_URL) }));
    expect(bgImageProbeForTests.listenerCount()).toBe(1);
    view.unmount();
    expect(bgImageProbeForTests.listenerCount(), 'an unmounted consumer left its store listener behind').toBe(0);

    // The probe is NOT aborted: its result serves the next mount.
    expect(() => act(() => images.settleAll())).not.toThrow();
    expect(errors.mock.calls, 'settling after unmount logged an error').toEqual([]);
    expect(images.liveHandlers()).toBe(0);

    const log: boolean[] = [];
    render(consumer({ id: 'next', style: styleFor(FAIL_URL), log }));
    expect(log[0], 'the result of a probe that outlived its consumer was lost').toBe(true);
  });

  it('X6 (88.9): an href first seen on a re-render (props change) is probed and its failure re-renders the consumer, including a failure that lands after commit but before the passive effect', () => {
    // Case 1: the consumer mounts on a working picture and is re-rendered onto a failing one.
    const first = render(consumer({ id: 'a', style: styleFor(OK_URL) }));
    act(() => images.settleAll());
    expect(arm('a')).toBe('photo');
    first.rerender(consumer({ id: 'a', style: styleFor(FAIL_URL) }));
    expect(images.srcs(), 'an href first seen on a re-render was never probed').toContain(hrefFor(FAIL_URL));
    expect(arm('a'), 'the photo arm did not paint while the new picture was pending').toBe('photo');
    act(() => images.settleAll());
    expect(arm('a'), 'the failure of a picture first seen on a re-render did not re-render the consumer').toBe('plain');
    first.unmount();

    // Case 2: the failing href is already IN FLIGHT for another consumer when this one first looks
    // it up, and its error lands after this consumer's commit but before any passive effect. A
    // later sibling's layout effect fires the error: layout effects run in tree order during the
    // commit, so it runs after the consumer's own layout effect and before every passive effect.
    const order: string[] = [];
    function Saboteur({ fire }: { fire: boolean }): null {
      useLayoutEffect(() => {
        if (!fire) return;
        order.push('error fired');
        images.settle(hrefFor(OTHER_FAIL_URL));
      });
      useEffect(() => {
        if (fire) order.push('passive effect');
      });
      return null;
    }
    const tree = (lateStyle: CSSProperties, fire: boolean): ReactElement =>
      createElement(
        'div',
        null,
        consumer({ id: 'holder', style: styleFor(OTHER_FAIL_URL) }),
        consumer({ id: 'late', style: lateStyle }),
        createElement(Saboteur, { key: 'saboteur', fire }),
      );

    const second = render(tree(styleFor(OTHER_OK_URL), false));
    expect(images.srcs().filter((src) => src === hrefFor(OTHER_FAIL_URL)), 'the in-flight probe is missing').toHaveLength(1);
    expect(arm('holder')).toBe('photo');
    expect(arm('late')).toBe('photo');

    second.rerender(tree(styleFor(OTHER_FAIL_URL), true));
    // The staging held: the error fired during the commit, before the first passive effect.
    expect(order.slice(0, 2), 'the error did not land between commit and the passive effects').toEqual(['error fired', 'passive effect']);
    expect(images.srcs().filter((src) => src === hrefFor(OTHER_FAIL_URL)), 'an in-flight href was probed twice').toHaveLength(1);
    expect(arm('holder')).toBe('plain');
    expect(
      arm('late'),
      'a failure that landed after commit but before the passive effect was dropped: the consumer kept the photo arm over a dead picture',
    ).toBe('plain');
  });

  it('X6 (88.9): a failed URL re-renders only consumers that looked it up', () => {
    const failing: boolean[] = [];
    const bystander: boolean[] = [];
    const noPicture: boolean[] = [];
    render(
      createElement(
        'div',
        null,
        consumer({ id: 'failing', style: styleFor(FAIL_URL), log: failing }),
        consumer({ id: 'bystander', style: styleFor(OK_URL), log: bystander }),
        consumer({ id: 'none', style: undefined, log: noPicture }),
      ),
    );
    const before = { failing: failing.length, bystander: bystander.length, none: noPicture.length };

    act(() => images.settle(hrefFor(FAIL_URL)));
    expect(arm('failing')).toBe('plain');
    expect(failing.length, 'the consumer showing the failed URL did not re-render').toBeGreaterThan(before.failing);
    expect(bystander.length, 'a consumer showing ANOTHER URL re-rendered on this failure').toBe(before.bystander);
    expect(noPicture.length, 'a consumer showing no picture re-rendered on this failure').toBe(before.none);
    expect(arm('bystander')).toBe('photo');
  });
});
