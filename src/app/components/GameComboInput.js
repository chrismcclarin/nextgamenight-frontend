'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { gamesAPI } from '../../lib/api';
import { Combobox } from '@/components/ui/Combobox';

/**
 * GameComboInput — the game picker. Phase 88-08 rebuilt its internals on the
 * `Combobox` primitive (UI-SPEC §8.5); the props, the search/debounce behaviour and
 * the selection semantics are unchanged, so no consumer needed an edit.
 *
 * What the adoption closed (both deferred from 87.7, both named in UI-SPEC §7.2/§7.3):
 * the clear button's stripped focus outline with no replacement ring (WCAG 2.4.7), and
 * its `title`-only accessible name. The field also inherits Req 1's 16px floor and the
 * `focus-visible` ring from `Input`, replacing the bare-`focus`-variant ring it shipped
 * with (the rejected utility name is deliberately not spelled out here, so the phase's
 * negative grep gate cannot match this comment).
 *
 * This file stays `.js`: the born-`.tsx` CI gate applies to NEW files, and converting a
 * shipped surface is a separate migration, not part of this adoption.
 */
// `inputRef` (88-33 Task 4, UAT row 291): optional external ref to the underlying text
// input, so a hosting modal can point `initialFocusRef` at it (createEvent focuses the
// game field on open). Merged with the internal ref — internal focus management keeps
// working whether or not a caller passes one.
// `id`/`name` (88-33 Task 8, fork 5 house rule): forwarded to the underlying text input
// so the caller's visible label can associate via htmlFor and the autofill heuristic
// (DevTools "form field should have an id or name") is satisfied.
export default function GameComboInput({ value, onChange, groupId, userId, placeholder, inputRef: externalInputRef, id, name }) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [localResults, setLocalResults] = useState([]);
  const [bggResults, setBggResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importingBggId, setImportingBggId] = useState(null);

  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  // Track whether input change is from internal typing vs external prop update
  const isInternalChange = useRef(false);

  // Sync input value from parent's value prop (external changes only)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    setInputValue(value?.game_name || '');
  }, [value?.game_id, value?.game_name]);

  // NOTE (88-08): the hand-rolled document `mousedown` click-outside listener that used
  // to live here is gone — `Combobox` runs floating-ui's `useDismiss`, which owns outside
  // press AND Escape and reports both through `onOpenChange`. Re-adding a second listener
  // would double-close and fight the primitive.

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const searchGames = useCallback(async (query) => {
    setIsSearching(true);
    try {
      const results = await gamesAPI.searchAll(query, groupId, userId);
      setLocalResults(results.local || []);
      setBggResults(results.bgg || []);
    } catch (error) {
      console.error('Error searching games:', error);
      setLocalResults([]);
      setBggResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [groupId, userId]);

  const handleInputChange = (text) => {
    isInternalChange.current = true;
    setInputValue(text);

    // If parent value has a game_id (user had selected a game), clear it
    if (value?.game_id) {
      onChange({ game_id: null, game_name: text || null });
    } else {
      // Always update parent with current text so form state stays in sync
      onChange({ game_id: null, game_name: text || null });
    }

    // Debounced search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        searchGames(text.trim());
      }, 300);
      // Show dropdown immediately (loading state) while waiting for results
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setLocalResults([]);
      setBggResults([]);
    }
  };

  const handleSelectLocal = useCallback((game) => {
    isInternalChange.current = true;
    setInputValue(game.name);
    onChange({ game_id: game.id, game_name: game.name });
    setIsOpen(false);
  }, [onChange]);

  const handleSelectBgg = useCallback(async (game) => {
    // Always go through import endpoint to ensure full BGG data (images, player count, etc.)
    // The backend will backfill missing data for CSV-imported games
    setImportingBggId(game.bgg_id);
    try {
      const imported = await gamesAPI.importFromBGG(game.bgg_id);
      isInternalChange.current = true;
      setInputValue(imported.name || game.name);
      onChange({ game_id: imported.id, game_name: imported.name || game.name });
      setIsOpen(false);
    } catch (error) {
      console.error('Error importing BGG game:', error);
      // Fallback: if import fails but we have a db_id, use it directly
      if (game.db_id) {
        isInternalChange.current = true;
        setInputValue(game.name);
        onChange({ game_id: game.db_id, game_name: game.name });
        setIsOpen(false);
      } else {
        alert(`Failed to import game from BGG: ${error.message || 'Please try again.'}`);
      }
    } finally {
      setImportingBggId(null);
    }
  }, [onChange]);

  const handleClear = () => {
    isInternalChange.current = true;
    setInputValue('');
    onChange({ game_id: null, game_name: null });
    setIsOpen(false);
    setLocalResults([]);
    setBggResults([]);
    inputRef.current?.focus();
  };

  const hasResults = localResults.length > 0 || bggResults.length > 0;
  const showDropdown = isOpen && (hasResults || isSearching);

  // One flat, ordered list so arrow keys traverse local results straight into the BGG
  // section; `group` is what splits them back into the two labelled sections visually.
  const items = useMemo(() => [
    ...localResults.map((game) => ({
      key: `local-${game.id}`,
      group: 'Your games',
      label: `${game.name}${game.year_published ? ` (${game.year_published})` : ''}`,
      onSelect: () => handleSelectLocal(game),
    })),
    ...bggResults.map((game) => ({
      key: `bgg-${game.bgg_id}`,
      group: 'BGG results',
      disabled: importingBggId === game.bgg_id,
      label: (
        <span>
          {game.name}
          {game.year_published ? ` (${game.year_published})` : ''}
          {importingBggId === game.bgg_id && (
            <span className="ml-2 text-sm text-content-muted">Importing...</span>
          )}
        </span>
      ),
      onSelect: () => handleSelectBgg(game),
    })),
  ], [localResults, bggResults, importingBggId, handleSelectLocal, handleSelectBgg]);

  const effectivePlaceholder = placeholder || 'Search for a game or type a name';

  return (
    <Combobox
      ref={(node) => {
        inputRef.current = node;
        if (externalInputRef) externalInputRef.current = node;
      }}
      id={id}
      name={name}
      items={items}
      value={inputValue}
      onValueChange={handleInputChange}
      open={showDropdown}
      onOpenChange={setIsOpen}
      loading={isSearching && !hasResults}
      loadingLabel="Searching..."
      emptyLabel="No results found"
      listLabel="Game suggestions"
      placeholder={effectivePlaceholder}
      // Every consumer renders a visible "Game"/"Game option N" label, but none of them
      // wires `htmlFor` — so the control has no programmatic name today. The placeholder
      // is the per-instance string that already distinguishes them (BallotOptionsEditor
      // renders several at once), so it is also the name. Giving the primitive a `label`
      // prop instead would change this component's public props, which 88-08 forbids.
      aria-label={effectivePlaceholder}
      maxLength={255}
      onFocus={() => {
        if (inputValue.trim().length >= 2 && hasResults) {
          setIsOpen(true);
        }
      }}
      trailing={
        inputValue ? (
          <button
            type="button"
            onClick={handleClear}
            /* DECISION Phase 88-08 (UI-SPEC §7.2 + §8.3's mechanism): the 44x44 touch target
               is reached with an INVISIBLE `after:` pseudo-element, chosen OVER enlarging the
               visible glyph or wrapping it in a padded box. Growing the glyph turns a quiet
               affordance into a second primary-looking control inside the field, and a padded
               wrapper changes layout flow; the pseudo-element changes neither flow nor the
               accessible tree. Same mechanism as `Switch` and `ClickableMemberName`.

               The `title` is KEPT for the desktop tooltip, but it is NOT the accessible name —
               `aria-label` is (§7.3: a bare `title` is not reliably exposed and is invisible on
               touch). Removing either one is a decision, not a cleanup. */
            className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-btn text-lg leading-none text-content-muted hover:text-content-secondary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring after:absolute after:-inset-2.5 after:content-['']"
            aria-label="Clear game selection"
            title="Clear game selection"
          >
            &times;
          </button>
        ) : null
      }
    />
  );
}
