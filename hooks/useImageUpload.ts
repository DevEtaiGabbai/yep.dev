import { useCallback, useState } from 'react';

export interface UploadedImage {
  url: string;
  signUrl: string;
  filename: string;
  size: number;
  type: string;
}

export const useImageUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadImage = useCallback(async (file: File): Promise<UploadedImage | null> => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file');
      return null;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setUploadError('Image size must be less than 10MB');
      return null;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/s3-upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const { url, signUrl } = await response.json();

      const absoluteUrl = typeof window !== 'undefined'
        ? `${window.location.origin}${url}`
        : url;

      return {
        url: absoluteUrl,
        signUrl,
        filename: file.name,
        size: file.size,
        type: file.type,
      };
    } catch (error) {
      console.error('Error uploading image:', error);
      setUploadError(error instanceof Error ? error.message : 'Failed to upload image. Please try again.');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);

  const uploadFromClipboard = useCallback(async (): Promise<UploadedImage | null> => {
    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            const blob = await clipboardItem.getType(type);
            const file = new File([blob], `pasted-image-${Date.now()}.png`, { type });
            console.log('Uploading file:', file);

            return await uploadImage(file);
          }
        }
      }

      setUploadError('No image found in clipboard');
      return null;
    } catch (error) {
      console.error('Error reading from clipboard:', error);
      setUploadError('Failed to read image from clipboard');
      return null;
    }
  }, [uploadImage]);

  return {
    uploadImage,
    uploadFromClipboard,
    isUploading,
    uploadError,
    clearError: () => setUploadError(null),
  };
};
