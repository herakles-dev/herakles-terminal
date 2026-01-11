import { useState, useEffect } from 'react';
import { uploadService, UploadProgress } from '../services/uploadService';

export function useUploadProgress(): UploadProgress[] {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);

  useEffect(() => {
    // Get initial state
    setUploads(uploadService.getUploads());
    
    // Subscribe to updates
    return uploadService.subscribe(setUploads);
  }, []);

  return uploads;
}
