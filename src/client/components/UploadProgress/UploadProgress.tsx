import { useUploadProgress } from '../../hooks/useUploadProgress';
import { uploadService } from '../../services/uploadService';

export function UploadProgress() {
  const uploads = useUploadProgress();
  const activeUploads = uploads.filter(u => u.status !== 'complete');

  if (activeUploads.length === 0) return null;

  const handleCancel = (fileId: string) => {
    uploadService.cancelUpload(fileId);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {activeUploads.map(upload => (
        <div 
          key={upload.fileId} 
          className="bg-[#111118] border border-white/[0.06] rounded-lg p-4 shadow-lg backdrop-blur-xl"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#d4d4d8] truncate max-w-[200px]">
              {upload.filename}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#a1a1aa]">
                {upload.status === 'uploading' ? `${upload.progress}%` : upload.status}
              </span>
              {upload.status === 'uploading' && (
                <button
                  onClick={() => handleCancel(upload.fileId)}
                  className="text-[#8a8a92] hover:text-[#d4d4d8] transition-colors"
                  title="Cancel upload"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                upload.status === 'error' ? 'bg-red-500' : 'bg-[#00d4ff]'
              }`}
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          {upload.error && (
            <p className="text-xs text-red-400 mt-1.5">{upload.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}
