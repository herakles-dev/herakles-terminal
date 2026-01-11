import { useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../services/api';

interface UploadedFile {
  path: string;
  filename: string;
  originalName?: string;
  size?: number;
  mimetype?: string;
}

interface ClipboardUploadOptions {
  /** Enable/disable clipboard paste listening (default: true) */
  enabled?: boolean;
  /** Called when upload starts */
  onUploadStart?: () => void;
  /** Called on successful upload */
  onUploadComplete?: (file: UploadedFile) => void;
  /** Called on upload error */
  onUploadError?: (error: string) => void;
}

interface ClipboardUploadResult {
  /** Manually trigger clipboard read and upload */
  uploadFromClipboard: () => Promise<void>;
  /** Whether an upload is currently in progress */
  isUploading: boolean;
}

/**
 * Hook for handling image paste from clipboard
 * 
 * Listens for paste events and automatically uploads images.
 * Text paste is passed through to allow terminal handling.
 * 
 * @example
 * ```tsx
 * const { uploadFromClipboard } = useClipboardUpload({
 *   onUploadStart: () => toast.info('Uploading...'),
 *   onUploadComplete: (file) => toast.success(`Uploaded ${file.filename}`),
 *   onUploadError: (error) => toast.error(error),
 * });
 * ```
 */
export function useClipboardUpload(options: ClipboardUploadOptions = {}): ClipboardUploadResult {
  const { 
    enabled = true, 
    onUploadStart, 
    onUploadComplete, 
    onUploadError 
  } = options;

  const isUploadingRef = useRef(false);

  /**
   * Generate a unique filename for clipboard images
   */
  const generateFilename = useCallback((mimeType: string): string => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return `clipboard-${timestamp}.${ext}`;
  }, []);

  /**
   * Upload a file to the server
   */
  const uploadFile = useCallback(async (file: File): Promise<void> => {
    if (isUploadingRef.current) return;
    
    isUploadingRef.current = true;
    onUploadStart?.();

    try {
      const formData = new FormData();
      formData.append('files', file);
      
      const response = await apiClient.post<{ files: UploadedFile[] }>('/uploads', formData);
      
      if (response.data?.files?.[0]) {
        onUploadComplete?.(response.data.files[0]);
      } else {
        onUploadError?.('Upload succeeded but no file returned');
      }
    } catch (err: unknown) {
      const errorMessage = 
        (err as { error?: { message?: string } })?.error?.message ||
        (err as Error)?.message ||
        'Clipboard upload failed';
      onUploadError?.(errorMessage);
    } finally {
      isUploadingRef.current = false;
    }
  }, [onUploadStart, onUploadComplete, onUploadError]);

  /**
   * Handle paste events from the document
   */
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    if (!enabled || isUploadingRef.current) return;
    
    const items = event.clipboardData?.items;
    if (!items) return;

    // Find image item in clipboard
    const imageItem = Array.from(items).find(item => 
      item.kind === 'file' && item.type.startsWith('image/')
    );
    
    if (!imageItem) {
      // No image found - let the event propagate for text paste handling
      return;
    }

    // Get file from clipboard
    const file = imageItem.getAsFile();
    if (!file) return;

    // Prevent default only when we're handling an image
    event.preventDefault();
    event.stopPropagation();
    
    // Create file with proper name
    const filename = generateFilename(file.type);
    const namedFile = new File([file], filename, { type: file.type });

    await uploadFile(namedFile);
  }, [enabled, generateFilename, uploadFile]);

  /**
   * Manually read from clipboard and upload (uses Clipboard API)
   * Useful for button-triggered uploads
   */
  const uploadFromClipboard = useCallback(async (): Promise<void> => {
    if (!enabled || isUploadingRef.current) return;

    try {
      // Check if Clipboard API is available
      if (!navigator.clipboard?.read) {
        onUploadError?.('Clipboard API not available');
        return;
      }

      const items = await navigator.clipboard.read();
      
      for (const item of items) {
        // Find image type in this item
        const imageType = item.types.find(type => type.startsWith('image/'));
        
        if (imageType) {
          const blob = await item.getType(imageType);
          const filename = generateFilename(imageType);
          const file = new File([blob], filename, { type: imageType });
          
          await uploadFile(file);
          return; // Upload first image found
        }
      }
      
      onUploadError?.('No image found in clipboard');
    } catch (err: unknown) {
      // Handle permission denied or other errors
      const errorMessage = 
        (err as Error)?.name === 'NotAllowedError'
          ? 'Clipboard access denied - please allow permission'
          : (err as Error)?.message || 'Failed to read clipboard';
      onUploadError?.(errorMessage);
    }
  }, [enabled, generateFilename, uploadFile, onUploadError]);

  // Register paste event listener
  useEffect(() => {
    if (!enabled) return;
    
    // Use capture phase to handle before terminal
    document.addEventListener('paste', handlePaste, { capture: true });
    
    return () => {
      document.removeEventListener('paste', handlePaste, { capture: true });
    };
  }, [enabled, handlePaste]);

  return { 
    uploadFromClipboard,
    isUploading: isUploadingRef.current,
  };
}

export type { ClipboardUploadOptions, ClipboardUploadResult, UploadedFile };
