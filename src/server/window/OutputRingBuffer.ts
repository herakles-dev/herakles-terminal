/**
 * OutputRingBuffer - Server-side per-window circular buffer for PTY output.
 *
 * Stores raw PTY output with monotonically increasing sequence numbers,
 * enabling clients to request replay of missed data after recovery/restore/resize.
 *
 * This eliminates the root cause of permanent data loss: the server was a dumb pipe
 * with no buffering, so any client discard during recovery windows was irreversible.
 */

export interface ReplayResult {
  data: string;
  fromSeq: number;
  toSeq: number;
}

interface BufferEntry {
  seq: number;
  data: string;
  byteLength: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024; // 256KB per window

export class OutputRingBuffer {
  private entries: BufferEntry[] = [];
  private totalBytes = 0;
  private nextSeq = 1;
  private maxBytes: number;

  constructor(maxBytes = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  /**
   * Append data to the ring buffer.
   * Returns the assigned sequence number.
   */
  append(data: string): number {
    const seq = this.nextSeq++;
    const byteLength = data.length; // JS string length approximates byte count for terminal data

    this.entries.push({ seq, data, byteLength });
    this.totalBytes += byteLength;

    // Evict oldest entries to stay within size limit
    while (this.totalBytes > this.maxBytes && this.entries.length > 1) {
      const evicted = this.entries.shift()!;
      this.totalBytes -= evicted.byteLength;
    }

    return seq;
  }

  /**
   * Get all data appended after the given sequence number.
   * Returns concatenated data and the sequence range.
   * Returns null if the requested sequence is no longer in the buffer (evicted).
   */
  getAfter(afterSeq: number): ReplayResult | null {
    if (this.entries.length === 0) {
      return { data: '', fromSeq: 0, toSeq: 0 };
    }

    const oldestSeq = this.entries[0].seq;
    const newestSeq = this.entries[this.entries.length - 1].seq;

    // If requested sequence is newer than what we have, nothing to replay
    if (afterSeq >= newestSeq) {
      return { data: '', fromSeq: afterSeq, toSeq: afterSeq };
    }

    // If requested sequence is older than our oldest entry, data was evicted
    if (afterSeq < oldestSeq - 1) {
      return null; // Gap detected - caller should do a full restore instead
    }

    // Find the first entry after the requested sequence
    let startIdx = 0;
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].seq > afterSeq) {
        startIdx = i;
        break;
      }
    }

    // Concatenate all data from startIdx onwards
    const chunks: string[] = [];
    for (let i = startIdx; i < this.entries.length; i++) {
      chunks.push(this.entries[i].data);
    }

    return {
      data: chunks.join(''),
      fromSeq: this.entries[startIdx].seq,
      toSeq: newestSeq,
    };
  }

  /**
   * Get the most recent N bytes of buffered output.
   * Used for restore operations as an alternative to tmux capture-pane.
   */
  getRecent(maxBytes: number): string {
    if (this.entries.length === 0) return '';

    const chunks: string[] = [];
    let collected = 0;

    // Walk backwards from newest to oldest
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (collected + entry.byteLength > maxBytes) {
        // Take a partial chunk from this entry
        const remaining = maxBytes - collected;
        if (remaining > 0) {
          chunks.unshift(entry.data.slice(-remaining));
        }
        break;
      }
      chunks.unshift(entry.data);
      collected += entry.byteLength;
    }

    return chunks.join('');
  }

  /**
   * Get the current sequence number (last assigned).
   * Returns 0 if no data has been appended.
   */
  getCurrentSeq(): number {
    return this.nextSeq - 1;
  }

  /**
   * Get buffer stats for monitoring.
   */
  getStats(): { entries: number; totalBytes: number; oldestSeq: number; newestSeq: number } {
    return {
      entries: this.entries.length,
      totalBytes: this.totalBytes,
      oldestSeq: this.entries.length > 0 ? this.entries[0].seq : 0,
      newestSeq: this.entries.length > 0 ? this.entries[this.entries.length - 1].seq : 0,
    };
  }

  /**
   * Clear the buffer. Used when a window is closed.
   */
  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }
}
