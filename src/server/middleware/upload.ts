import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { Request } from 'express';
import sharp from 'sharp';
import { AutheliaUser } from './autheliaAuth.js';

const UPLOAD_ROOT = '/home/hercules/uploads';
const MAX_FILE_SIZE = 100 * 1024 * 1024;  // 100MB per file
const MAX_FILES_PER_REQUEST = 10;
const USER_QUOTA_BYTES = 500 * 1024 * 1024;  // 500MB total per user
const THUMBNAIL_SIZE = 200;

const ALLOWED_TYPES = {
  images: [
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
    'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif',
    'image/avif', 'image/ico', 'image/x-icon',
  ],
  documents: [
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'text/html', 'text/css', 'text/javascript', 'application/json',
    'application/xml', 'text/xml',
    // Office docs
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Code files
    'application/javascript', 'application/typescript',
  ],
  archives: [
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/gzip', 'application/x-tar', 'application/x-bzip2',
  ],
  media: [
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  ],
  other: [
    'application/octet-stream',  // Allow unknown binary files
  ],
};

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

const storage = multer.diskStorage({
  destination: async (req: AuthenticatedRequest, _file, cb) => {
    const userEmail = req.user?.email || 'anonymous';
    const today = new Date().toISOString().split('T')[0];
    const uploadDir = path.join(UPLOAD_ROOT, userEmail, today);
    
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err as Error, uploadDir);
    }
  },
  
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .substring(0, 50);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    cb(null, `${basename}-${timestamp}-${random}${ext}`);
  },
});

// Common code file extensions to allow regardless of MIME type
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.scala',
  '.sh', '.bash', '.zsh', '.fish', '.yml', '.yaml', '.toml', '.ini',
  '.conf', '.cfg', '.env', '.sql', '.graphql', '.proto', '.md', '.mdx',
  '.rst', '.tex', '.log', '.diff', '.patch', '.json', '.xml', '.csv',
  '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
]);

// Dangerous file types to always reject for security
const DANGEROUS_TYPES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-msdos-program',
  'application/x-dosexec',
]);

const fileFilter = async (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allAllowed = [
    ...ALLOWED_TYPES.images,
    ...ALLOWED_TYPES.documents,
    ...ALLOWED_TYPES.archives,
    ...ALLOWED_TYPES.media,
    ...ALLOWED_TYPES.other,
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Reject dangerous executable types
  if (DANGEROUS_TYPES.has(file.mimetype)) {
    return cb(new Error(`File type ${file.mimetype} not allowed for security reasons`));
  }
  
  // Allow if MIME type is in our allowed list
  if (allAllowed.includes(file.mimetype)) {
    return cb(null, true);
  }
  
  // Allow if extension is in our allowed extensions (code files often have generic MIME)
  if (ALLOWED_EXTENSIONS.has(ext)) {
    return cb(null, true);
  }
  
  // For all other files, allow them (user requested all file types)
  // The validateUploadedFile function will do additional security checks
  cb(null, true);
};

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES_PER_REQUEST,
  },
});

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
  'application/x-gzip',
]);

// MIME types that are text-based and don't have magic bytes
const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css',
  'text/javascript', 'application/json', 'application/xml', 'text/xml',
  'application/javascript', 'application/typescript',
]);

// Dangerous magic bytes to detect executables
const DANGEROUS_MAGIC = [
  { bytes: [0x4D, 0x5A], name: 'Windows Executable (MZ)' },  // PE/MZ executables
  { bytes: [0x7F, 0x45, 0x4C, 0x46], name: 'Linux Executable (ELF)' },  // ELF binaries
];

export async function validateUploadedFile(filePath: string, originalMime: string): Promise<boolean> {
  const buffer = await fs.readFile(filePath);
  const headerBytes = buffer.slice(0, 4100);
  
  // Check for dangerous executable magic bytes
  for (const magic of DANGEROUS_MAGIC) {
    let matches = true;
    for (let i = 0; i < magic.bytes.length; i++) {
      if (headerBytes[i] !== magic.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return false;  // Reject executables
    }
  }
  
  const fileType = await fileTypeFromBuffer(headerBytes);
  
  // No detected file type - likely a text file
  if (!fileType) {
    // Allow text-based MIME types
    if (TEXT_MIMES.has(originalMime)) {
      return true;
    }
    // Allow application/octet-stream for unknown binary types
    if (originalMime === 'application/octet-stream') {
      return true;
    }
    // Allow files with code extensions (they often have generic MIME)
    const ext = path.extname(filePath).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return true;
    }
    // For other files, allow if they appear to be text (no null bytes in first 1KB)
    const sampleBytes = headerBytes.slice(0, 1024);
    const hasNullByte = sampleBytes.includes(0);
    return !hasNullByte;  // Allow text, reject binary without detected type
  }
  
  // Archive files - allow if detected type is also an archive
  if (ARCHIVE_MIMES.has(originalMime) && ARCHIVE_MIMES.has(fileType.mime)) {
    return true;
  }
  
  // Image files - allow common image formats
  const imageMimes = new Set(ALLOWED_TYPES.images);
  if (imageMimes.has(originalMime) && imageMimes.has(fileType.mime)) {
    return true;
  }
  
  // Media files - allow audio/video
  const mediaMimes = new Set(ALLOWED_TYPES.media);
  if (mediaMimes.has(fileType.mime)) {
    return true;
  }
  
  // PDF files
  if (fileType.mime === 'application/pdf' && originalMime === 'application/pdf') {
    return true;
  }
  
  // Office documents - detected type may differ slightly, allow if in documents list
  const docMimes = new Set(ALLOWED_TYPES.documents);
  if (docMimes.has(fileType.mime) || docMimes.has(originalMime)) {
    return true;
  }
  
  // For all other detected file types, allow them (user requested all file types)
  // We've already rejected executables above
  return true;
}

export async function generateThumbnail(imagePath: string): Promise<string | null> {
  try {
    const ext = path.extname(imagePath);
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase())) {
      return null;
    }

    const thumbnailPath = imagePath.replace(ext, `_thumb${ext}`);
    
    await sharp(imagePath)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFile(thumbnailPath);
    
    return thumbnailPath;
  } catch {
    return null;
  }
}

export async function getUserStorageUsage(userEmail: string): Promise<number> {
  const userDir = path.join(UPLOAD_ROOT, userEmail);
  
  try {
    await fs.access(userDir);
  } catch {
    return 0;
  }

  let totalBytes = 0;
  const days = await fs.readdir(userDir);
  
  for (const day of days) {
    const dayPath = path.join(userDir, day);
    const files = await fs.readdir(dayPath);
    
    for (const file of files) {
      const filePath = path.join(dayPath, file);
      const stats = await fs.stat(filePath);
      totalBytes += stats.size;
    }
  }
  
  return totalBytes;
}

export async function checkUserQuota(userEmail: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const used = await getUserStorageUsage(userEmail);
  return {
    allowed: used < USER_QUOTA_BYTES,
    used,
    limit: USER_QUOTA_BYTES,
  };
}
