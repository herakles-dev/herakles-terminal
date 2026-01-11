import { SessionStore } from '../session/SessionStore.js';
import { config } from '../config.js';

export interface SoftLock {
  deviceId: string;
  expiresAt: number;
}

export interface DeviceInfo {
  id: string;
  userEmail: string;
  name?: string;
  userAgent?: string;
}

type LockCallback = (windowId: string, deviceId: string, expiresAt: number) => void;
type DeviceCallback = (sessionId: string, deviceId: string, deviceName?: string) => void;

export class MultiDeviceManager {
  private store: SessionStore;
  private locks: Map<string, SoftLock> = new Map();
  private activeDevices: Map<string, Set<string>> = new Map();
  private lockAcquiredCallbacks: LockCallback[] = [];
  private lockReleasedCallbacks: ((windowId: string) => void)[] = [];
  private deviceJoinedCallbacks: DeviceCallback[] = [];
  private deviceLeftCallbacks: DeviceCallback[] = [];
  private cleanupInterval: NodeJS.Timeout;

  constructor(store: SessionStore) {
    this.store = store;
    this.cleanupInterval = setInterval(() => this.cleanupExpiredLocks(), 1000);
  }

  trackInput(windowId: string, deviceId: string): boolean {
    const lock = this.locks.get(windowId);
    
    if (lock && lock.deviceId !== deviceId && lock.expiresAt > Date.now()) {
      return false;
    }

    this.acquireLock(windowId, deviceId);
    return true;
  }

  isLocked(windowId: string, deviceId: string): boolean {
    const lock = this.locks.get(windowId);
    if (!lock) return false;
    if (lock.expiresAt <= Date.now()) {
      this.locks.delete(windowId);
      return false;
    }
    return lock.deviceId !== deviceId;
  }

  acquireLock(windowId: string, deviceId: string): SoftLock {
    const expiresAt = Date.now() + config.multiDevice.softLockMs;
    const lock: SoftLock = { deviceId, expiresAt };
    
    this.locks.set(windowId, lock);
    
    for (const callback of this.lockAcquiredCallbacks) {
      callback(windowId, deviceId, expiresAt);
    }
    
    return lock;
  }

  releaseLock(windowId: string, deviceId: string): void {
    const lock = this.locks.get(windowId);
    if (lock && lock.deviceId === deviceId) {
      this.locks.delete(windowId);
      
      for (const callback of this.lockReleasedCallbacks) {
        callback(windowId);
      }
    }
  }

  getLock(windowId: string): SoftLock | null {
    const lock = this.locks.get(windowId);
    if (!lock || lock.expiresAt <= Date.now()) {
      this.locks.delete(windowId);
      return null;
    }
    return lock;
  }

  registerDevice(sessionId: string, device: DeviceInfo): void {
    this.store.registerDevice({
      id: device.id,
      user_email: device.userEmail,
      name: device.name || null,
      user_agent: device.userAgent || null,
    });

    let devices = this.activeDevices.get(sessionId);
    if (!devices) {
      devices = new Set();
      this.activeDevices.set(sessionId, devices);
    }
    devices.add(device.id);

    for (const callback of this.deviceJoinedCallbacks) {
      callback(sessionId, device.id, device.name);
    }
  }

  unregisterDevice(sessionId: string, deviceId: string): void {
    const devices = this.activeDevices.get(sessionId);
    if (devices) {
      devices.delete(deviceId);
      if (devices.size === 0) {
        this.activeDevices.delete(sessionId);
      }
    }

    for (const [windowId, lock] of this.locks.entries()) {
      if (lock.deviceId === deviceId) {
        this.locks.delete(windowId);
        for (const callback of this.lockReleasedCallbacks) {
          callback(windowId);
        }
      }
    }

    for (const callback of this.deviceLeftCallbacks) {
      callback(sessionId, deviceId);
    }
  }

  getActiveDevices(sessionId: string): string[] {
    const devices = this.activeDevices.get(sessionId);
    return devices ? Array.from(devices) : [];
  }

  getActiveDeviceCount(sessionId: string): number {
    const devices = this.activeDevices.get(sessionId);
    return devices ? devices.size : 0;
  }

  updateDeviceSeen(deviceId: string): void {
    this.store.updateDeviceSeen(deviceId);
  }

  onLockAcquired(callback: LockCallback): void {
    this.lockAcquiredCallbacks.push(callback);
  }

  onLockReleased(callback: (windowId: string) => void): void {
    this.lockReleasedCallbacks.push(callback);
  }

  onDeviceJoined(callback: DeviceCallback): void {
    this.deviceJoinedCallbacks.push(callback);
  }

  onDeviceLeft(callback: DeviceCallback): void {
    this.deviceLeftCallbacks.push(callback);
  }

  private cleanupExpiredLocks(): void {
    const now = Date.now();
    for (const [windowId, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(windowId);
        for (const callback of this.lockReleasedCallbacks) {
          callback(windowId);
        }
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.locks.clear();
    this.activeDevices.clear();
    this.lockAcquiredCallbacks = [];
    this.lockReleasedCallbacks = [];
    this.deviceJoinedCallbacks = [];
    this.deviceLeftCallbacks = [];
  }
}
