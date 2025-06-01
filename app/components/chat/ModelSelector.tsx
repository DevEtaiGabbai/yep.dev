import { classNames } from '@/app/utils/classNames';
import { DEFAULT_PROVIDER } from '@/lib/provider';
import { ModelInfo } from '@/lib/types/index';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

interface ModelSelectorProps {
  model?: string;
  setModel?: (model: string) => void;
  modelList: ModelInfo[];
  apiKeys: Record<string, string>;
  modelLoading?: string;
}

export const ModelSelector = ({
  model,
  setModel,
  modelList,
  modelLoading,
}: ModelSelectorProps) => {
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [focusedModelIndex, setFocusedModelIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<'top' | 'bottom'>('bottom');
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const modelOptionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchOverlayRef = useRef<HTMLDivElement>(null);
  const dropdownListContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        modelDropdownRef.current && !modelDropdownRef.current.contains(target) &&
        (!searchOverlayRef.current || !searchOverlayRef.current.contains(target)) &&
        (!dropdownListContainerRef.current || !dropdownListContainerRef.current.contains(target))
      ) {
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate dropdown position based on available space
  const calculateDropdownPosition = () => {
    if (!triggerRef.current) return 'bottom';

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const dropdownHeight = 300; // Approximate max height of dropdown

    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    // If there's not enough space below but enough space above, open upward
    if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
      return 'top';
    }

    return 'bottom';
  };

  const handleDropdownToggle = () => {
    if (!isModelDropdownOpen && triggerRef.current) {
      const position = calculateDropdownPosition();
      setDropdownPosition(position);
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    } else if (isModelDropdownOpen) {
      setTriggerRect(null);
    }
    setIsModelDropdownOpen(!isModelDropdownOpen);
    if (isModelDropdownOpen) {
      setModelSearchQuery('');
    }
  };

  const filteredModels = [...modelList]
    .filter((e) => e.provider === DEFAULT_PROVIDER?.name && e.name)
    .filter(
      (model) =>
        model.label.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
        model.name.toLowerCase().includes(modelSearchQuery.toLowerCase()),
    );

  useEffect(() => {
    setFocusedModelIndex(-1);
  }, [modelSearchQuery, isModelDropdownOpen]);

  useEffect(() => {
    if (isModelDropdownOpen && modelSearchInputRef.current) {
      modelSearchInputRef.current.focus();
    }
  }, [isModelDropdownOpen]);

  const handleModelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isModelDropdownOpen) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedModelIndex((prev) => (prev + 1 >= filteredModels.length ? 0 : prev + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedModelIndex((prev) => (prev - 1 < 0 ? filteredModels.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();

        if (focusedModelIndex >= 0 && focusedModelIndex < filteredModels.length) {
          const selectedModel = filteredModels[focusedModelIndex];
          setModel?.(selectedModel.name);
          setIsModelDropdownOpen(false);
          setModelSearchQuery('');
        }

        break;
      case 'Escape':
        e.preventDefault();
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
        break;
      case 'Tab':
        if (!e.shiftKey && focusedModelIndex === filteredModels.length - 1) {
          setIsModelDropdownOpen(false);
        }

        break;
    }
  };

  useEffect(() => {
    if (focusedModelIndex >= 0 && modelOptionsRef.current[focusedModelIndex]) {
      modelOptionsRef.current[focusedModelIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedModelIndex]);

  if (modelList.length === 0) {
    return (
      <div className="p-2 rounded-xl border border-[#313133] bg-[#161618] transition-all cursor-pointer ">
        <p className="text-left">
          Loading models...
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 flex-col sm:flex-row">
        {/* Model Combobox */}
        <div className="relative flex w-full min-w-[70%]" ref={modelDropdownRef}>
          <div
            ref={triggerRef}
            className={classNames(
              'w-full p-2 rounded-xl border border-[#313133]',
              'transition-all cursor-pointer flex items-center justify-between',
              'bg-[#161618]',
              isModelDropdownOpen ? 'ring-2 ring-bolt-elements-focus' : 'focus:ring-2 focus:ring-bolt-elements-focus',
              isModelDropdownOpen && triggerRect ? 'opacity-50' : ''
            )}
            onClick={handleDropdownToggle}
            onKeyDown={(e) => {
              if (!isModelDropdownOpen && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleDropdownToggle();
              }
            }}
            role="combobox"
            aria-expanded={isModelDropdownOpen}
            aria-controls="model-listbox"
            aria-haspopup="listbox"
            tabIndex={isModelDropdownOpen ? -1 : 0}
          >
            <div className="truncate flex-grow">{modelList.find((m) => m.name === model)?.label || 'Select model'}</div>
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 text-bolt-elements-textSecondary opacity-75 ml-2 flex-shrink-0',
                isModelDropdownOpen ? 'rotate-180' : undefined,
              )}
            />
          </div>
        </div>
      </div>

      {isModelDropdownOpen && triggerRect && (
        <>
          <div
            ref={searchOverlayRef}
            className="fixed z-[100000] flex items-center justify-between bg-[#161618] border border-[#313133] rounded-xl ring-2 ring-bolt-elements-focus"
            style={{
              left: triggerRect.left,
              top: triggerRect.top,
              width: triggerRect.width,
              height: triggerRect.height,
              boxSizing: 'border-box',
            }}
            onKeyDown={handleModelKeyDown}
          >
            <div className="relative flex-grow h-full px-2 flex items-center">
              <input
                ref={modelSearchInputRef}
                type="text"
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                placeholder="Search models..."
                className={classNames(
                  'w-full h-full bg-transparent border-0 focus:outline-none focus:ring-0',
                  'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary'
                )}
                role="searchbox"
                aria-label="Search models"
              />
            </div>
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 text-bolt-elements-textSecondary opacity-75 ml-auto mr-2 flex-shrink-0',
                'rotate-180'
              )}
            />
          </div>

          <div
            ref={dropdownListContainerRef}
            className="fixed z-[99999] bg-[#161618] shadow-2xl border border-[#313133] rounded-lg"
            style={{
              left: triggerRect.left,
              width: triggerRect.width,
              ...(dropdownPosition === 'top'
                ? { bottom: window.innerHeight - triggerRect.top + 4 }
                : { top: triggerRect.bottom + 4 }
              ),
              visibility: triggerRect ? 'visible' : 'hidden'
            }}
            role="listbox"
            id="model-listbox"
            onKeyDown={handleModelKeyDown}
          >
            <div
              className={classNames(
                'max-h-60 overflow-y-auto bg-[#161618]',
                'rounded-lg',
                'sm:scrollbar-none',
                '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
                '[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor',
                '[&::-webkit-scrollbar-thumb]:hover:bg-bolt-elements-borderColorHover',
                '[&::-webkit-scrollbar-thumb]:rounded-full',
                '[&::-webkit-scrollbar-track]:bg-bolt-elements-background-depth-2',
                '[&::-webkit-scrollbar-track]:rounded-full',
                'sm:[&::-webkit-scrollbar]:w-1.5 sm:[&::-webkit-scrollbar]:h-1.5',
                'sm:hover:[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor/50',
                'sm:hover:[&::-webkit-scrollbar-thumb:hover]:bg-bolt-elements-borderColor',
              )}
            >
              {modelLoading === 'all' || modelLoading === DEFAULT_PROVIDER?.name ? (
                <div className="px-3 py-2 text-sm text-bolt-elements-textTertiary">Loading...</div>
              ) : filteredModels.length === 0 ? (
                <div className="px-3 py-2 text-sm text-bolt-elements-textTertiary">No models found</div>
              ) : (
                filteredModels.map((modelOption, index) => (
                  <div
                    ref={(el) => {
                      if (el) modelOptionsRef.current[index] = el;
                    }}
                    key={modelOption.name}
                    role="option"
                    aria-selected={model === modelOption.name}
                    className={classNames(
                      'px-3 py-2 text-sm cursor-pointer',
                      'hover:bg-bolt-elements-background-depth-3',
                      'text-bolt-elements-textPrimary',
                      'outline-none',
                      model === modelOption.name || focusedModelIndex === index
                        ? 'bg-bolt-elements-background-depth-2'
                        : undefined,
                      focusedModelIndex === index ? 'ring-1 ring-inset ring-bolt-elements-focus' : undefined,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModel?.(modelOption.name);
                      setIsModelDropdownOpen(false);
                      setModelSearchQuery('');
                    }}
                    tabIndex={focusedModelIndex === index ? 0 : -1}
                  >
                    {modelOption.label}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};
