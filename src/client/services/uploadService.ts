import { apiUrl } from './api';

interface UploadProgress {
  fileId: string;
  filename: string;
  progress: number;  // 0-100
  status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

interface UploadResult {
  id: string;
  filename: string;
  originalName: string;
  path: string;
  size: number;
  mimeType: string;
  hasThumbnail: boolean;
  hasOptimized: boolean;
  optimizedPath?: string;
}

type ProgressCallback = (progress: UploadProgress[]) => void;

class UploadService {
  private progressCallbacks: Set<ProgressCallback> = new Set();
  private uploads: Map<string, UploadProgress> = new Map();
  private activeXhrs: Map<string, XMLHttpRequest> = new Map();

  // Subscribe to progress updates
  subscribe(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private notify(): void {
    const progress = Array.from(this.uploads.values());
    this.progressCallbacks.forEach(cb => cb(progress));
  }

  // Upload files with progress tracking using XMLHttpRequest
  async uploadFiles(files: File[]): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    
    for (const file of files) {
      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      this.uploads.set(fileId, {
        fileId,
        filename: file.name,
        progress: 0,
        status: 'pending',
      });
      this.notify();

      try {
        const result = await this.uploadFile(file, fileId);
        results.push(result);
        
        this.uploads.set(fileId, {
          fileId,
          filename: file.name,
          progress: 100,
          status: 'complete',
        });
        this.notify();
        
        // Remove from tracking after 3 seconds
        setTimeout(() => {
          this.uploads.delete(fileId);
          this.activeXhrs.delete(fileId);
          this.notify();
        }, 3000);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';
        this.uploads.set(fileId, {
          fileId,
          filename: file.name,
          progress: 0,
          status: 'error',
          error: errorMessage,
        });
        this.notify();
        this.activeXhrs.delete(fileId);
      }
    }

    return results;
  }

  private uploadFile(file: File, fileId: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeXhrs.set(fileId, xhr);
      
      const formData = new FormData();
      formData.append('files', file);

      // Get CSRF token first
      fetch(apiUrl('/csrf-token'), { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);
              this.uploads.set(fileId, {
                fileId,
                filename: file.name,
                progress,
                status: 'uploading',
              });
              this.notify();
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                if (response.data?.files?.[0]) {
                  resolve(response.data.files[0]);
                } else {
                  reject(new Error('No file in response'));
                }
              } catch {
                reject(new Error('Invalid response format'));
              }
            } else {
              try {
                const error = JSON.parse(xhr.responseText);
                reject(new Error(error.error?.message || 'Upload failed'));
              } catch {
                reject(new Error(`Upload failed with status ${xhr.status}`));
              }
            }
          };

          xhr.onerror = () => reject(new Error('Network error'));
          xhr.onabort = () => reject(new Error('Upload cancelled'));

          xhr.open('POST', apiUrl('/uploads'));
          xhr.withCredentials = true;
          if (data.data?.token) {
            xhr.setRequestHeader('x-csrf-token', data.data.token);
          }
          xhr.send(formData);
        })
        .catch(reject);
    });
  }

  // Get current upload status
  getUploads(): UploadProgress[] {
    return Array.from(this.uploads.values());
  }

  // Cancel upload (if XHR still in progress)
  cancelUpload(fileId: string): void {
    const xhr = this.activeXhrs.get(fileId);
    if (xhr) {
      xhr.abort();
    }
    this.uploads.delete(fileId);
    this.activeXhrs.delete(fileId);
    this.notify();
  }

  // Clear all completed or errored uploads
  clearCompleted(): void {
    for (const [fileId, upload] of this.uploads.entries()) {
      if (upload.status === 'complete' || upload.status === 'error') {
        this.uploads.delete(fileId);
      }
    }
    this.notify();
  }
}

export const uploadService = new UploadService();
export type { UploadProgress, UploadResult };
