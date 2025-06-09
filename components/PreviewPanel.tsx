'use client';

import { $workbench, setActivePreview } from '@/app/lib/stores/workbenchStore';
import { useStore } from '@nanostores/react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortDropdown } from './PortDropdown';
import { Button } from './ui/button';
import { Icons } from './ui/icons';

export function PreviewPanel() {
  const workbenchState = useStore($workbench);
  const { activePreviewUrl, previews, activePreviewPort } = workbenchState;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(activePreviewUrl);
  
  useEffect(() => {
    if (activePreviewUrl !== iframeSrc) {
      setIframeSrc(activePreviewUrl);
    }
  }, [activePreviewUrl, iframeSrc]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && iframeSrc) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = 'about:blank';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = currentSrc;
        }
      }, 50);
    }
  }, [iframeSrc]);

  const handleOpenInNewTab = useCallback(() => {
    if (iframeSrc) {
      window.open(iframeSrc, '_blank');
    }
  }, [iframeSrc]);

  // Add effect to check if we need to start a dev server when preview tab is opened
  useEffect(() => {
    // If preview panel is mounted but no previews are available, 
    // dispatch a custom event to potentially start the dev server
    if (previews.length === 0 && !iframeSrc) {
      const event = new CustomEvent('requestDevServer', { 
        detail: { reason: 'preview_tab_opened' } 
      });
      window.dispatchEvent(event);
    }
  }, [previews.length, iframeSrc]);

  return (
    <div className="flex flex-col h-full bg-[#101012]">
      <div className="flex items-center p-2 border-b border-[#313133] bg-[#161618] flex-shrink-0 h-10">
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={!iframeSrc} className="text-[#969798] hover:text-white h-7 w-7">
          <RefreshCw size={16} />
        </Button>
        <div className="flex-1 mx-2">
          <input
            type="text"
            readOnly
            value={iframeSrc || 'No preview available'}
            className="w-full p-1.5 text-xs bg-[#101012] text-[#969798] rounded border border-[#313133] focus:outline-none truncate h-7"
            title={iframeSrc || 'No preview available'}
          />
        </div>
        {previews && previews.length > 0 && (
          <PortDropdown />
        )}

        <Button variant="ghost" size="icon" onClick={handleOpenInNewTab} disabled={!iframeSrc} className="text-[#969798] hover:text-white h-7 w-7">
          <ExternalLink size={16} />
        </Button>
      </div>
      <div className="flex-1 bg-white relative min-h-0">
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            key={iframeSrc}
            src={iframeSrc}
            title="WebContainer Preview"
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock allow-presentation allow-top-navigation allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
            allow="geolocation; microphone; camera; display-capture; encrypted-media; fullscreen; payment; clipboard-read; clipboard-write; xr-spatial-tracking; web-share"
            loading="eager"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#969798] bg-[#101012]">
            <Icons.github className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">Preview will appear here once the server starts.</p>
            <p className="text-xs mt-1 opacity-70">Ensure your application&apos;s dev server is running.</p>
          </div>
        )}
      </div>
    </div>
  );
}
