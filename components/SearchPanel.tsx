'use client';

import { $workbench, setSelectedFile, setWorkbenchView, type WorkbenchFile } from '@/app/lib/stores/workbenchStore';
import { useStore } from '@nanostores/react';
import { ChevronDown, ChevronRight, Circle, Code, File, Replace, Search, Type, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';

interface SearchResult {
  filePath: string;
  fileName: string;
  matches: Array<{
    line: number;
    column: number;
    text: string;
    matchStart: number;
    matchEnd: number;
    preview: string;
  }>;
}

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export function SearchPanel() {
  const { files, selectedFile } = useStore($workbench);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Perform search across all files
  const searchResults = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return [];

    setIsSearching(true);
    const results: SearchResult[] = [];

    try {
      // Create search regex based on options
      let searchRegex: RegExp;
      if (searchOptions.useRegex) {
        try {
          searchRegex = new RegExp(
            debouncedSearchQuery,
            `g${searchOptions.caseSensitive ? '' : 'i'}`
          );
        } catch (e) {
          // Invalid regex, return empty results
          setIsSearching(false);
          return [];
        }
      } else {
        const escapedQuery = debouncedSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = searchOptions.wholeWord
          ? `\\b${escapedQuery}\\b`
          : escapedQuery;
        searchRegex = new RegExp(
          pattern,
          `g${searchOptions.caseSensitive ? '' : 'i'}`
        );
      }

      // Search through all files
      Object.entries(files).forEach(([filePath, fileEntry]) => {
        if (fileEntry?.type === 'file') {
          const file = fileEntry as WorkbenchFile;
          if (file.isBinary) return; // Skip binary files
          
          // Skip certain files that are typically not useful for search
          const fileName = filePath.split('/').pop() || '';
          const excludedFiles = [
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            '.DS_Store',
            'Thumbs.db'
          ];
          if (excludedFiles.includes(fileName)) return;

          const lines = file.content.split('\n');
          const matches: SearchResult['matches'] = [];

          lines.forEach((line, lineIndex) => {
            let match;
            searchRegex.lastIndex = 0; // Reset regex state

            while ((match = searchRegex.exec(line)) !== null) {
              const matchStart = match.index;
              const matchEnd = match.index + match[0].length;

              // Create preview with context
              const previewStart = Math.max(0, matchStart - 20);
              const previewEnd = Math.min(line.length, matchEnd + 20);
              const preview = line.substring(previewStart, previewEnd);

              matches.push({
                line: lineIndex + 1,
                column: matchStart + 1,
                text: match[0],
                matchStart,
                matchEnd,
                preview: preview,
              });

              // Prevent infinite loop for zero-width matches
              if (match[0].length === 0) {
                searchRegex.lastIndex++;
              }
            }
          });

          if (matches.length > 0) {
            results.push({
              filePath,
              fileName: filePath.split('/').pop() || filePath,
              matches,
            });
          }
        }
      });
    } catch (error) {
      console.error('Search error:', error);
    }

    setIsSearching(false);
    return results;
  }, [debouncedSearchQuery, files, searchOptions]);

  // Auto-expand files with results
  useEffect(() => {
    if (searchResults.length > 0) {
      const newExpanded = new Set(expandedFiles);
      searchResults.forEach(result => {
        newExpanded.add(result.filePath);
      });
      setExpandedFiles(newExpanded);
    }
  }, [searchResults]);

  const toggleFileExpansion = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const handleResultClick = useCallback((filePath: string, line?: number, column?: number) => {
    // Set the selected file in workbench - this will automatically load the file content
    setSelectedFile(filePath);
    
    // Switch to Editor view to show the file content
    setWorkbenchView('Editor');

    // If line/column provided, scroll to that position
    if (line && column) {
      // Use setTimeout to ensure the file is loaded first
      setTimeout(() => {
        const currentDoc = $workbench.get().currentDocument;
        if (currentDoc && currentDoc.filePath === filePath) {
          $workbench.setKey('currentDocument', {
            ...currentDoc,
            scroll: { line, column, top: 0, left: 0 }
          });
        }
      }, 100);
    }
  }, []);

  const handleReplaceAll = useCallback(() => {
    if (!debouncedSearchQuery.trim() || !replaceQuery) return;

    // This would require implementing replace functionality
    // For now, just show a placeholder
  }, [debouncedSearchQuery, replaceQuery]);

  const totalMatches = useMemo(() => {
    return searchResults.reduce((total, result) => total + result.matches.length, 0);
  }, [searchResults]);

  return (
    <div className="flex flex-col h-full bg-[#101012] text-[#c0c0c0]">
      {/* Search Input */}
      <div className="p-3 border-b border-[#313133] space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[#969798]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="pl-8 bg-[#161618] border-[#313133] text-[#c0c0c0] placeholder:text-[#969798] focus:border-[#007acc] focus:ring-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none transition-all duration-200"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-[#2a2a2c]"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Replace Input */}
        {showReplace && (
          <div className="relative">
            <Replace className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[#969798]" />
            <Input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace"
              className="pl-8 bg-[#161618] border-[#313133] text-[#c0c0c0] placeholder:text-[#969798] focus:border-[#007acc] focus:outline-none focus:ring-0 text-sm"
            />
          </div>
        )}

        {/* Search Options */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOptions(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
              className={`h-6 w-6 p-0 ${searchOptions.caseSensitive ? 'bg-[#007acc] text-white' : 'hover:bg-[#2a2a2c]'}`}
              title="Match Case"
            >
              <Type className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOptions(prev => ({ ...prev, wholeWord: !prev.wholeWord }))}
              className={`h-6 w-6 p-0 ${searchOptions.wholeWord ? 'bg-[#007acc] text-white' : 'hover:bg-[#2a2a2c]'}`}
              title="Match Whole Word"
            >
              <Circle className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOptions(prev => ({ ...prev, useRegex: !prev.useRegex }))}
              className={`h-6 w-6 p-0 ${searchOptions.useRegex ? 'bg-[#007acc] text-white' : 'hover:bg-[#2a2a2c]'}`}
              title="Use Regular Expression"
            >
              <Code className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReplace(!showReplace)}
              className="h-6 px-2 text-xs hover:bg-[#2a2a2c]"
              title="Toggle Replace"
            >
              <Replace className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Results Summary */}
        {searchQuery && (
          <div className="text-xs text-[#969798]">
            {searchQuery !== debouncedSearchQuery || isSearching ? (
              'Searching...'
            ) : (
              `${totalMatches} results in ${searchResults.length} files`
            )}
          </div>
        )}
      </div>

      {/* Search Results */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {debouncedSearchQuery && !isSearching && searchResults.length === 0 && (
            <div className="text-center text-[#969798] text-sm py-4">
              No results found
            </div>
          )}

          {searchResults.map((result) => (
            <div key={result.filePath} className="mb-2">
              {/* File Header */}
              <div className="flex items-center p-1 hover:bg-[#2a2a2c] cursor-pointer rounded text-sm">
                <div
                  className="flex items-center flex-shrink-0"
                  onClick={() => toggleFileExpansion(result.filePath)}
                >
                  {expandedFiles.has(result.filePath) ? (
                    <ChevronDown className="h-3 w-3 mr-1" />
                  ) : (
                    <ChevronRight className="h-3 w-3 mr-1" />
                  )}
                </div>
                <div
                  className="flex items-center flex-1 min-w-0"
                  onClick={() => handleResultClick(result.filePath)}
                >
                  <File className="h-3 w-3 mr-2 text-[#007acc]" />
                  <span className="text-[#c0c0c0] truncate flex-1">{result.fileName}</span>
                </div>
                <span className="text-[#969798] text-xs ml-2 flex-shrink-0">
                  {result.matches.length}
                </span>
              </div>

              {/* Match Results */}
              {expandedFiles.has(result.filePath) && (
                <div className="ml-6 space-y-1">
                  {result.matches.map((match, index) => (
                    <div
                      key={index}
                      className="flex items-start p-1 hover:bg-[#2a2a2c] cursor-pointer rounded text-xs"
                      onClick={() => handleResultClick(result.filePath, match.line, match.column)}
                    >
                      <span className="text-[#969798] w-8 text-right mr-2 flex-shrink-0">
                        {match.line}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#c0c0c0] truncate font-mono">
                          {match.preview.substring(0, match.matchStart - Math.max(0, match.matchStart - 20))}
                          <span className="bg-[#007acc] text-white px-0.5">
                            {match.text}
                          </span>
                          {match.preview.substring(match.matchEnd - Math.max(0, match.matchStart - 20))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Replace Actions */}
      {showReplace && debouncedSearchQuery && searchResults.length > 0 && (
        <div className="p-2 border-t border-[#313133]">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReplaceAll}
            className="w-full text-xs bg-[#161618] border-[#313133] hover:bg-[#2a2a2c]"
          >
            Replace All ({totalMatches})
          </Button>
        </div>
      )}
    </div>
  );
}
