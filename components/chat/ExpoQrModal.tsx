// components/ExpoQrModal.tsx
'use client';

import { expoUrlAtom } from '@/app/lib/stores/qrCodeStore';
import { useStore } from '@nanostores/react';
// import { QRCode } from 'react-qrcode-logo'; // You'd need to install this or use another QR library

interface ExpoQrModalProps {
    open: boolean;
    onClose: () => void;
    // expoUrl: string | null; // expoUrl will be read from the store
}

export const ExpoQrModal: React.FC<ExpoQrModalProps> = ({ open, onClose }) => {
    const expoUrl = useStore(expoUrlAtom);

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-background p-6 rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-semibold mb-4">Scan with Expo Go</h2>
                {expoUrl ? (
                    <div> {/* Replace with actual QR code component if needed */}
                        <p className="text-sm">QR Code for: {expoUrl}</p>
                        <p className="text-xs mt-2">(QR Code rendering component not implemented here)</p>
                        {/* Example: <QRCode value={expoUrl} size={200} /> */}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">No Expo URL available.</p>
                )}
                <button onClick={onClose} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded">
                    Close
                </button>
            </div>
        </div>
    );
};
