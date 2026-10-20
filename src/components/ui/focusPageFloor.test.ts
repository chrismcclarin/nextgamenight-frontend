// focusPageFloor — the one page-level focus floor (Phase 88.6.1, D-07 util half, D-05, OQ-5),
// plus the shared primitives isFocusLost / focusElement and the tabindex-lifetime rule.
//
// Line comments only (FE-TESTING-CONVENTIONS CF-9). Fixtures are static markup assigned to the
// body per test and cleared afterwards. Every floor call goes through floorChecked, which pins
// that the floor mints nothing (case 12): the element count and the body text are identical
// before and after.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { focusElement, focusPageFloor, isFocusLost } from './focusPageFloor';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// Case 12, the shared no-mint helper, called by every floor case in this file.
function floorChecked(origin?: Element | null): HTMLElement | null {
  const elementsBefore = document.querySelectorAll('*').length;
  const textBefore = document.body.textContent;
  const result = focusPageFloor(origin);
  expect(document.querySelectorAll('*').length).toBe(elementsBefore);
  expect(document.body.textContent).toBe(textBefore);
  return result;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture is missing #${id}`);
  return el;
}

// One macrotask: the strip branch of the tabindex-lifetime rule runs its check in a
// setTimeout(0), so every lifetime assertion waits for it first.
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A node that refuses focus: its focus() is a no-op (the analogue of a disabled opener).
function refuseFocus(el: HTMLElement) {
  el.focus = () => {};
}

describe('focusPageFloor — the order: open dialog title, then main h1, then main', () => {
  it('case 1: an open dialog wins over the page; its aria-labelledby title takes focus (P-3)', () => {
    document.body.innerHTML = `
      <main><h1 id="page-h1">Game night</h1></main>
      <div role="dialog" data-state="open" aria-labelledby="dlg-title" tabindex="-1" id="dlg">
        <h2 id="dlg-title">Members</h2>
        <button type="button">Close</button>
      </div>`;
    const result = floorChecked();
    expect(result).toBe(byId('dlg-title'));
    expect(document.activeElement).toBe(byId('dlg-title'));
  });

  it('case 2: a dialog whose data-state is closed is ignored, and the page h1 takes focus', () => {
    document.body.innerHTML = `
      <main><h1 id="page-h1">Game night</h1></main>
      <div role="dialog" data-state="closed" aria-labelledby="dlg-title" tabindex="-1">
        <h2 id="dlg-title">Members</h2>
      </div>`;
    const result = floorChecked();
    expect(result).toBe(byId('page-h1'));
    expect(document.activeElement).toBe(byId('page-h1'));
  });

  it('case 3: with two open dialogs, the origin dialog wins; with no origin, the last (topmost) wins', () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1></main>
      <div role="dialog" data-state="open" aria-labelledby="first-title" tabindex="-1">
        <h2 id="first-title">First</h2>
        <button type="button" id="inside-first">Inside first</button>
      </div>
      <div role="dialog" data-state="open" aria-labelledby="second-title" tabindex="-1">
        <h2 id="second-title">Second</h2>
      </div>`;
    expect(floorChecked(byId('inside-first'))).toBe(byId('first-title'));
    expect(document.activeElement).toBe(byId('first-title'));

    expect(floorChecked()).toBe(byId('second-title'));
    expect(document.activeElement).toBe(byId('second-title'));
  });

  it('case 4a: a dialog with no aria-labelledby resolves to its first heading', () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1></main>
      <div role="dialog" data-state="open" tabindex="-1">
        <p>Intro</p>
        <h3 id="first-heading">Settings</h3>
        <h2>Later</h2>
      </div>`;
    expect(floorChecked()).toBe(byId('first-heading'));
    expect(document.activeElement).toBe(byId('first-heading'));
  });

  it('case 4b: a dialog with no heading resolves to its container, whose own tabindex survives a blur', async () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1></main>
      <div role="dialog" data-state="open" tabindex="-1" id="dlg">
        <p>No heading here</p>
        <button type="button" id="inside">Inside</button>
      </div>`;
    const dialog = byId('dlg');
    expect(floorChecked()).toBe(dialog);
    expect(document.activeElement).toBe(dialog);

    byId('inside').focus();
    await macrotask();
    expect(dialog.getAttribute('tabindex')).toBe('-1');
  });

  it('case 5: aria-labelledby ids resolve by getElementById, so a colon-bearing Radix id works', () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1></main>
      <div role="dialog" data-state="open" aria-labelledby="missing radix-:r1:" tabindex="-1">
        <h3>Not the title</h3>
        <h2 id="radix-:r1:">Members</h2>
      </div>`;
    const title = byId('radix-:r1:');
    expect(floorChecked()).toBe(title);
    expect(document.activeElement).toBe(title);
  });

  it('case 6: role=alertdialog counts as a dialog', () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1></main>
      <div role="alertdialog" data-state="open" aria-labelledby="alert-title" tabindex="-1">
        <h2 id="alert-title">Delete this?</h2>
      </div>`;
    expect(floorChecked()).toBe(byId('alert-title'));
    expect(document.activeElement).toBe(byId('alert-title'));
  });

  it('case 7: with no dialog, main h1 takes focus with an added tabindex=-1, which a heading KEEPS after focus leaves', async () => {
    document.body.innerHTML = `
      <main><h1 id="page-h1">Game night</h1><button type="button" id="other">Other</button></main>`;
    const h1 = byId('page-h1');
    expect(h1.hasAttribute('tabindex')).toBe(false);
    expect(floorChecked()).toBe(h1);
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');

    byId('other').focus();
    await macrotask();
    expect(document.activeElement).toBe(byId('other'));
    expect(h1.getAttribute('tabindex')).toBe('-1');
  });

  it('case 8: a main h1 that refuses focus falls through to main', () => {
    document.body.innerHTML = `<main id="main"><h1 id="page-h1">Game night</h1></main>`;
    const h1 = byId('page-h1');
    refuseFocus(h1);
    expect(floorChecked()).toBe(byId('main'));
    expect(document.activeElement).toBe(byId('main'));
    // The failed retry on the h1 left no residue.
    expect(h1.hasAttribute('tabindex')).toBe(false);
  });

  it('case 9: main, with no h1, takes focus with an added tabindex; a window blur keeps it, a real focus move strips it', async () => {
    document.body.innerHTML = `
      <main id="main"><p>Your groups</p><button type="button" id="other">Other</button></main>`;
    const main = byId('main');
    expect(floorChecked()).toBe(main);
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');

    // Arm (b) FIRST: a blur while main is still the active element (the window-blur shape).
    main.dispatchEvent(new FocusEvent('blur'));
    await macrotask();
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');

    // Arm (a) SECOND, on the same element: a real focus move removes it (the KebabMenu 88.6-16
    // consequence). Running (a) after (b) is what catches a once-only listener.
    byId('other').focus();
    await macrotask();
    expect(document.activeElement).toBe(byId('other'));
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('case 9c: a main that already carries tabindex=0 keeps it after focus leaves', async () => {
    document.body.innerHTML = `
      <main id="main" tabindex="0"><p>Your groups</p><button type="button" id="other">Other</button></main>`;
    const main = byId('main');
    expect(floorChecked()).toBe(main);
    byId('other').focus();
    await macrotask();
    expect(main.getAttribute('tabindex')).toBe('0');
  });

  it('case 10: with no dialog and no main, the floor returns null and focus does not move', () => {
    document.body.innerHTML = `<div><h1>Game night</h1><button type="button" id="here">Here</button></div>`;
    byId('here').focus();
    expect(floorChecked()).toBeNull();
    expect(document.activeElement).toBe(byId('here'));
  });

  it('case 11: an open dialog whose title and container refuse focus returns null and never floors to the page', () => {
    document.body.innerHTML = `
      <main><h1 id="page-h1">Game night</h1></main>
      <div role="dialog" data-state="open" aria-labelledby="dlg-title" tabindex="-1" id="dlg">
        <h2 id="dlg-title">Members</h2>
      </div>`;
    refuseFocus(byId('dlg-title'));
    refuseFocus(byId('dlg'));
    expect(floorChecked()).toBeNull();
    expect(document.activeElement).not.toBe(byId('page-h1'));
    expect(document.activeElement).toBe(document.body);
  });

  it('case 17: an aria-labelledby target OUTSIDE the dialog is skipped; the in-dialog heading takes focus', () => {
    document.body.innerHTML = `
      <main><h1>Game night</h1><h2 id="outside-title">Outside heading</h2></main>
      <div role="dialog" data-state="open" aria-labelledby="outside-title" tabindex="-1">
        <h2 id="inside-title">Members</h2>
      </div>`;
    const outside = byId('outside-title');
    const outsideFocuses = vi.fn();
    outside.addEventListener('focus', outsideFocuses);

    expect(floorChecked()).toBe(byId('inside-title'));
    expect(document.activeElement).toBe(byId('inside-title'));
    expect(outsideFocuses).not.toHaveBeenCalled();
    expect(outside.hasAttribute('tabindex')).toBe(false);
  });
});

describe('isFocusLost — the one definition of lost focus (D-04)', () => {
  it('case 13: body and a dialog container are lost, a focused button is not, a detached active element is lost', () => {
    document.body.innerHTML = `
      <button type="button" id="btn">A button</button>
      <div role="dialog" data-state="open" tabindex="-1" id="dlg"><p>Body text</p></div>`;
    expect(document.activeElement).toBe(document.body);
    expect(isFocusLost()).toBe(true);

    byId('btn').focus();
    expect(isFocusLost()).toBe(false);

    byId('dlg').focus();
    expect(document.activeElement).toBe(byId('dlg'));
    expect(isFocusLost()).toBe(true);

    const detached = document.createElement('button');
    vi.spyOn(Document.prototype, 'activeElement', 'get').mockReturnValue(detached);
    expect(document.activeElement).toBe(detached);
    expect(isFocusLost()).toBe(true);
  });
});

describe('focusElement — the outcome check and the tabindex-lifetime rule', () => {
  it('case 14: false for null, undefined and a detached node; a failed retry strips the attribute it added', () => {
    expect(focusElement(null)).toBe(false);
    expect(focusElement(undefined)).toBe(false);
    expect(focusElement(document.createElement('button'))).toBe(false);

    document.body.innerHTML = `
      <div id="stubborn">Cannot focus</div>
      <button type="button" id="disabled" disabled>Disabled</button>
      <span id="carried" tabindex="-1">Carried</span>`;
    const stubborn = byId('stubborn');
    refuseFocus(stubborn);
    expect(focusElement(stubborn)).toBe(false);
    expect(stubborn.hasAttribute('tabindex')).toBe(false);

    const disabled = byId('disabled');
    expect(focusElement(disabled)).toBe(false);
    expect(disabled.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(document.body);

    // An attribute the element already carried is never touched, even when focus fails.
    const carried = byId('carried');
    refuseFocus(carried);
    expect(focusElement(carried)).toBe(false);
    expect(carried.getAttribute('tabindex')).toBe('-1');
  });

  it('case 15: a non-heading inside an OPEN dialog keeps its added attribute after focus moves within the dialog', async () => {
    document.body.innerHTML = `
      <div role="dialog" data-state="open" tabindex="-1">
        <p id="note">Two members left</p>
        <button type="button" id="close">Close</button>
      </div>`;
    const note = byId('note');
    expect(focusElement(note)).toBe(true);
    expect(document.activeElement).toBe(note);
    expect(note.getAttribute('tabindex')).toBe('-1');

    byId('close').focus();
    await macrotask();
    expect(document.activeElement).toBe(byId('close'));
    expect(note.getAttribute('tabindex')).toBe('-1');
  });

  it('case 16 (control, GREEN at birth): a non-heading inside main, outside any dialog, loses its added attribute once focus leaves', async () => {
    document.body.innerHTML = `
      <main><p id="note">Your groups</p><button type="button" id="other">Other</button></main>`;
    const note = byId('note');
    expect(focusElement(note)).toBe(true);
    expect(note.getAttribute('tabindex')).toBe('-1');

    byId('other').focus();
    await macrotask();
    expect(note.hasAttribute('tabindex')).toBe(false);
  });
});
