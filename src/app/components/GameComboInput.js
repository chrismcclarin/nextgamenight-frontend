'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { gamesAPI } from '../../lib/api';

export default function GameComboInput({ value, onChange, groupId, userId, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [localResults, setLocalResults] = useState([]);
  const [bggResults, setBggResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importingBggId, setImportingBggId] = useState(null);

  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
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

  // Click outside to close dropdown
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

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

  const handleSelectLocal = (game) => {
    isInternalChange.current = true;
    setInputValue(game.name);
    onChange({ game_id: game.id, game_name: game.name });
    setIsOpen(false);
  };

  const handleSelectBgg = async (game) => {
    if (game.db_id) {
      // Already in database, use db_id directly
      isInternalChange.current = true;
      setInputValue(game.name);
      onChange({ game_id: game.db_id, game_name: game.name });
      setIsOpen(false);
    } else {
      // Need to import from BGG first
      setImportingBggId(game.bgg_id);
      try {
        const imported = await gamesAPI.importFromBGG(game.bgg_id);
        isInternalChange.current = true;
        setInputValue(imported.name || game.name);
        onChange({ game_id: imported.id, game_name: imported.name || game.name });
        setIsOpen(false);
      } catch (error) {
        console.error('Error importing BGG game:', error);
        alert(`Failed to import game from BGG: ${error.message || 'Please try again.'}`);
      } finally {
        setImportingBggId(null);
      }
    }
  };

  const handleClear = () => {
    isInternalChange.current = true;
    setInputValue('');
    onChange({ game_id: null, game_name: null });
    setIsOpen(false);
    setLocalResults([]);
    setBggResults([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter' && isOpen) {
      e.preventDefault();
      // Select first visible result
      if (localResults.length > 0) {
        handleSelectLocal(localResults[0]);
      } else if (bggResults.length > 0) {
        handleSelectBgg(bggResults[0]);
      }
    }
  };

  const hasResults = localResults.length > 0 || bggResults.length > 0;
  const showDropdown = isOpen && (hasResults || isSearching);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (inputValue.trim().length >= 2 && hasResults) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Search for a game or type a name'}
          className="w-full p-2 border rounded text-gray-900 bg-white pr-8"
          maxLength={255}
        />
        {inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 text-gray-400 hover:text-gray-600 text-lg leading-none focus:outline-none"
            title="Clear game selection"
          >
            &times;
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto">
          {isSearching && localResults.length === 0 && bggResults.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">
              Searching...
            </div>
          )}

          {localResults.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                Your games
              </div>
              {localResults.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => handleSelectLocal(game)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-blue-50 cursor-pointer"
                >
                  {game.name}
                  {game.year_published ? ` (${game.year_published})` : ''}
                </button>
              ))}
            </div>
          )}

          {bggResults.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                BGG results
              </div>
              {bggResults.map((game) => (
                <button
                  key={game.bgg_id}
                  type="button"
                  onClick={() => handleSelectBgg(game)}
                  disabled={importingBggId === game.bgg_id}
                  className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-blue-50 cursor-pointer disabled:opacity-50"
                >
                  {game.name}
                  {game.year_published ? ` (${game.year_published})` : ''}
                  {importingBggId === game.bgg_id && (
                    <span className="ml-2 text-xs text-gray-400">Importing...</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!isSearching && !hasResults && (
            <div className="px-3 py-2 text-sm text-gray-500">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
