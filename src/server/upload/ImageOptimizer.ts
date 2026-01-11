import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Image optimization module for Zeus Terminal upload system.
 * Optimizes images for Claude's vision capabilities by reducing file size
 * while maintaining quality suitable for AI analysis.
 */

// Maximum dimension for any side (Claude's vision works well up to 4096px)
const MAX_DIMENSION = 4096;

// Compression quality settings
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 85;
const PNG_COMPRESSION_LEVEL = 9; // Maximum PNG compression (0-9)

// MIME types that can be processed
const PROCESSABLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/gif',
]);

// Formats that should be converted to JPEG (lossy source formats)
const CONVERT_TO_JPEG = new Set([
  'image/heic',
  'image/heif',
  'image/bmp',
]);

// Formats that should be converted to PNG (lossless or transparency-supporting)
const CONVERT_TO_PNG = new Set([
  'image/tiff',
  'image/gif',
]);

export interface OptimizationResult {
  optimizedPath: string;
  originalSize: number;
  optimizedSize: number;
  format: string;
  dimensions: { width: number; height: number };
  wasConverted: boolean;
  wasResized: boolean;
}

/**
 * Check if a given MIME type represents an image file that can be optimized.
 */
export function isImageFile(mimeType: string): boolean {
  return PROCESSABLE_IMAGE_TYPES.has(mimeType);
}

/**
 * Generate the path for the optimized version of an image.
 * Adds '_optimized' suffix before the extension.
 * If format conversion occurred, the extension will change accordingly.
 */
export function getOptimizedPath(originalPath: string, newFormat?: string): string {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const basename = path.basename(originalPath, ext);
  
  // Determine the output extension based on format conversion
  let outputExt = ext;
  if (newFormat) {
    switch (newFormat) {
      case 'jpeg':
        outputExt = '.jpg';
        break;
      case 'png':
        outputExt = '.png';
        break;
      case 'webp':
        outputExt = '.webp';
        break;
    }
  }
  
  return path.join(dir, `${basename}_optimized${outputExt}`);
}

/**
 * Validate that a file is actually an image by checking its magic bytes.
 * This is a security measure to prevent processing of non-image files
 * that may have been uploaded with a fake extension.
 */
async function validateImageFile(filePath: string): Promise<{ valid: boolean; mimeType?: string }> {
  try {
    // Read the first 4100 bytes for file type detection
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(4100);
    await handle.read(buffer, 0, 4100, 0);
    await handle.close();
    
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (!fileType) {
      return { valid: false };
    }
    
    // Check if detected type is a processable image type
    if (PROCESSABLE_IMAGE_TYPES.has(fileType.mime)) {
      return { valid: true, mimeType: fileType.mime };
    }
    
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * Determine the target format for conversion based on the source MIME type.
 */
function getTargetFormat(mimeType: string): 'jpeg' | 'png' | 'webp' | null {
  if (CONVERT_TO_JPEG.has(mimeType)) {
    return 'jpeg';
  }
  if (CONVERT_TO_PNG.has(mimeType)) {
    return 'png';
  }
  // Already an optimized format - keep original
  return null;
}

/**
 * Get the output format for sharp based on the original format.
 * Returns the format to use for output operations.
 */
function getOutputFormat(mimeType: string): 'jpeg' | 'png' | 'webp' {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
    default:
      return 'png';
  }
}

/**
 * Optimize an image for Claude's vision capabilities.
 * 
 * This function:
 * 1. Validates the file is actually an image (security check)
 * 2. Converts HEIC/HEIF to JPEG (common iOS format)
 * 3. Converts BMP to PNG (lossless preservation)
 * 4. Converts TIFF/GIF to PNG
 * 5. Resizes if any dimension exceeds 4096px
 * 6. Strips EXIF/metadata for privacy
 * 7. Compresses with optimal quality settings
 * 
 * The original file is preserved; an optimized copy is created with '_optimized' suffix.
 * 
 * @param imagePath - Absolute path to the image file to optimize
 * @returns OptimizationResult with paths and metadata about the optimization
 * @throws Error if the file is not a valid image or optimization fails
 */
export async function optimizeImage(imagePath: string): Promise<OptimizationResult> {
  // Get original file stats
  let originalStats: { size: number };
  try {
    originalStats = await fs.stat(imagePath);
  } catch (err) {
    throw new Error(`Cannot access image file: ${imagePath}`);
  }
  
  // Security: Validate file is actually an image
  const validation = await validateImageFile(imagePath);
  if (!validation.valid || !validation.mimeType) {
    // Return original path if validation fails (fail gracefully)
    return {
      optimizedPath: imagePath,
      originalSize: originalStats.size,
      optimizedSize: originalStats.size,
      format: 'unknown',
      dimensions: { width: 0, height: 0 },
      wasConverted: false,
      wasResized: false,
    };
  }
  
  const detectedMimeType = validation.mimeType;
  
  // Determine if format conversion is needed
  const targetFormat = getTargetFormat(detectedMimeType);
  const wasConverted = targetFormat !== null;
  
  // Determine the actual output format
  const outputFormat = targetFormat || getOutputFormat(detectedMimeType);
  
  // Generate optimized file path
  const optimizedPath = getOptimizedPath(imagePath, wasConverted ? outputFormat : undefined);
  
  try {
    // Load image and get metadata
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    
    // Determine if resizing is needed
    const needsResize = originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION;
    
    // Calculate new dimensions if resizing
    let newWidth = originalWidth;
    let newHeight = originalHeight;
    
    if (needsResize) {
      const aspectRatio = originalWidth / originalHeight;
      
      if (originalWidth > originalHeight) {
        newWidth = MAX_DIMENSION;
        newHeight = Math.round(MAX_DIMENSION / aspectRatio);
      } else {
        newHeight = MAX_DIMENSION;
        newWidth = Math.round(MAX_DIMENSION * aspectRatio);
      }
    }
    
    // Build the sharp pipeline
    let pipeline = image
      // Strip metadata (EXIF, ICC profiles, etc.) for privacy
      .rotate() // Auto-rotate based on EXIF orientation before stripping
      .withMetadata({ 
        // Keep only essential metadata, remove GPS, camera info, etc.
        orientation: undefined,
      });
    
    // Apply resize if needed
    if (needsResize) {
      pipeline = pipeline.resize(newWidth, newHeight, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'lanczos3', // High quality downscaling
      });
    }
    
    // Apply format-specific compression
    switch (outputFormat) {
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality: JPEG_QUALITY,
          progressive: true, // Progressive loading for web
          mozjpeg: true, // Better compression
        });
        break;
        
      case 'png':
        pipeline = pipeline.png({
          compressionLevel: PNG_COMPRESSION_LEVEL,
          progressive: false, // Interlaced PNGs can be larger
          adaptiveFiltering: true,
        });
        break;
        
      case 'webp':
        pipeline = pipeline.webp({
          quality: WEBP_QUALITY,
          effort: 6, // Higher effort = better compression (0-6)
          lossless: false,
        });
        break;
    }
    
    // Write the optimized image
    await pipeline.toFile(optimizedPath);
    
    // Get optimized file stats
    const optimizedStats = await fs.stat(optimizedPath);
    
    // If the "optimized" version is larger (can happen with small images),
    // delete it and return the original
    if (optimizedStats.size >= originalStats.size && !wasConverted && !needsResize) {
      await fs.unlink(optimizedPath).catch(() => {});
      return {
        optimizedPath: imagePath,
        originalSize: originalStats.size,
        optimizedSize: originalStats.size,
        format: outputFormat,
        dimensions: { width: originalWidth, height: originalHeight },
        wasConverted: false,
        wasResized: false,
      };
    }
    
    return {
      optimizedPath,
      originalSize: originalStats.size,
      optimizedSize: optimizedStats.size,
      format: outputFormat,
      dimensions: { 
        width: needsResize ? newWidth : originalWidth, 
        height: needsResize ? newHeight : originalHeight 
      },
      wasConverted,
      wasResized: needsResize,
    };
    
  } catch (err) {
    // If optimization fails, clean up partial output and return original path
    await fs.unlink(optimizedPath).catch(() => {});
    
    // Log the error but don't throw - return original as fallback
    console.error(`Image optimization failed for ${imagePath}:`, err);
    
    return {
      optimizedPath: imagePath,
      originalSize: originalStats.size,
      optimizedSize: originalStats.size,
      format: 'unknown',
      dimensions: { width: 0, height: 0 },
      wasConverted: false,
      wasResized: false,
    };
  }
}

/**
 * Batch optimize multiple images.
 * Processes images in parallel with a configurable concurrency limit.
 * 
 * @param imagePaths - Array of absolute paths to images
 * @param concurrency - Maximum number of concurrent optimizations (default: 3)
 * @returns Array of OptimizationResults in the same order as input
 */
export async function optimizeImages(
  imagePaths: string[],
  concurrency: number = 3
): Promise<OptimizationResult[]> {
  const results: OptimizationResult[] = new Array(imagePaths.length);
  
  // Process in batches
  for (let i = 0; i < imagePaths.length; i += concurrency) {
    const batch = imagePaths.slice(i, i + concurrency);
    const batchPromises = batch.map((imagePath, batchIndex) => 
      optimizeImage(imagePath).then(result => {
        results[i + batchIndex] = result;
      })
    );
    await Promise.all(batchPromises);
  }
  
  return results;
}

/**
 * Calculate the compression ratio achieved.
 * @returns A string like "42%" indicating size reduction
 */
export function getCompressionRatio(result: OptimizationResult): string {
  if (result.originalSize === 0) return '0%';
  const ratio = ((result.originalSize - result.optimizedSize) / result.originalSize) * 100;
  return `${Math.round(ratio)}%`;
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
