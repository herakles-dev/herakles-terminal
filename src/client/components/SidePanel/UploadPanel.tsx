import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../../services/api';

interface UploadedFile {
  filename: string;
  date: string;
  size: number;
  uploadedAt: string;
  path: string;
  hasThumbnail: boolean;
}

interface Quota {
  used: number;
  limit: number;
  percentUsed: number;
}

export default function UploadPanel() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [quota, setQuota] = useState<Quota>({ used: 0, limit: 500 * 1024 * 1024, percentUsed: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const response = await apiClient.get<{ files: UploadedFile[]; quota: Quota }>('/uploads');
      if (response.data) {
        setFiles(response.data.files || []);
        setQuota(response.data.quota || { used: 0, limit: 500 * 1024 * 1024, percentUsed: 0 });
      }
      setError(null);
    } catch (err) {
      setError('Failed to load files');
      console.error('Error loading files:', err);
    }
  };

  const handleUpload = async (fileList: FileList) => {
    const maxSize = 50 * 1024 * 1024;  // 50MB per file
    
    const validFiles = Array.from(fileList).filter(file => {
      if (file.size > maxSize) {
        setError(`${file.name} exceeds 50MB limit`);
        return false;
      }
      // Allow all file types - server will validate for security
      return true;
    });

    if (validFiles.length === 0) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    validFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await apiClient.post<{ files: any[]; quota: Quota }>('/uploads', formData);
      if (response.data) {
        setQuota(response.data.quota);
        await loadFiles();
      }
    } catch (err: any) {
      setError(err?.error?.message || 'Upload failed');
      console.error('Error uploading files:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (date: string, filename: string) => {
    try {
      await apiClient.delete(`/uploads/${date}/${filename}`);
      setFiles(files.filter(f => !(f.date === date && f.filename === filename)));
      await loadFiles();
      setError(null);
    } catch (err) {
      setError('Failed to delete file');
      console.error('Error deleting file:', err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragIn = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true);
    }
  };

  const handleDragOut = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getFileIcon = (_filename: string, hasThumbnail: boolean) => {
    if (hasThumbnail) {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col bg-[#07070a] p-3">
      <div className="mb-3 border-b border-[#1a1a1e] pb-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-[#8a8a92] uppercase tracking-[0.1em]">Storage</span>
          <span className={`text-[11px] font-mono ${quota.percentUsed > 80 ? 'text-[#d08030]' : 'text-[#8a8a92]'}`}>
            {formatFileSize(quota.used)}/{formatFileSize(quota.limit)}
          </span>
        </div>
        <div className="w-full bg-[#101014] rounded h-1.5">
          <div
            className={`h-1.5 rounded transition-all ${
              quota.percentUsed > 80 ? 'bg-[#d08030]' : 'bg-[#00b8db]'
            }`}
            style={{ width: `${Math.min(quota.percentUsed, 100)}%` }}
          />
        </div>
      </div>

      <div
        className={`mb-3 border border-dashed rounded p-4 text-center transition-all cursor-pointer ${
          dragActive
            ? 'border-[#00b8db] bg-[#00b8db]/5'
            : 'border-[#1e1e24] bg-[#0a0a0c] hover:border-[#2a2a30]'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDrag}
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onClick={() => fileInputRef.current?.click()}
      >
        <svg className={`w-7 h-7 mx-auto mb-2 ${dragActive ? 'text-[#00b8db]' : 'text-[#3a3a42]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        
        <p className="text-[13px] text-[#a1a1aa] mb-1">
          {uploading ? 'Uploading...' : 'Drop or click to upload'}
        </p>
        <p className="text-[11px] text-[#3a3a42]">
          All file types supported (50MB max)
        </p>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mb-2 p-2 bg-[#c04040]/8 border border-[#c04040]/15 rounded flex items-center gap-2">
          <svg className="w-4 h-4 text-[#c04040]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-[12px] text-[#c04040]">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <h3 className="text-[11px] font-semibold text-[#8a8a92] uppercase tracking-[0.1em] mb-2">Files</h3>
        
        <div className="space-y-1 overflow-y-auto max-h-full">
          {files.length === 0 ? (
            <p className="text-[12px] text-[#3a3a42] italic">No files uploaded</p>
          ) : (
            files.map((file) => (
              <div
                key={`${file.date}-${file.filename}`}
                className="bg-[#0c0c10] rounded p-2.5 hover:bg-[#14141a] transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex-shrink-0">
                    {file.hasThumbnail ? (
                      <img
                        src={`/api/uploads/${file.date}/${file.filename}/thumbnail`}
                        alt={file.filename}
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-[#14141a] rounded flex items-center justify-center text-[#00b8db]">
                        {getFileIcon(file.filename, file.hasThumbnail)}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-mono text-[#c0c0c8] truncate">{file.filename}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-[#8a8a92]">{formatFileSize(file.size)}</span>
                      <span className="text-[11px] text-[#2a2a30]">•</span>
                      <span className="text-[11px] text-[#8a8a92]">{formatDate(file.uploadedAt)}</span>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    <a
                      href={`/api/uploads/${file.date}/${file.filename}`}
                      download
                      className="p-1.5 text-[#71717a] hover:text-[#00b8db] transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                    
                    <button
                      onClick={() => handleDelete(file.date, file.filename)}
                      className="p-1.5 text-[#71717a] hover:text-[#c04040] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
