import { Injectable, NgZone } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class WakeLockService {
  private wakeLock: any = null;
  private isEnabled = true;
  public onStateChange?: (isActive: boolean) => void;

  constructor(private ngZone: NgZone) {
    // Re-acquire lock when user switches back to the tab/app
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isEnabled) {
          this.requestWakeLock();
        }
      });
    }
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  isLockActive(): boolean {
    return this.wakeLock !== null && !this.wakeLock.released;
  }

  async requestWakeLock(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('[WakeLock] Screen Wake Lock API is not supported on this browser.');
      return false;
    }

    try {
      if (this.wakeLock !== null && !this.wakeLock.released) {
        this.onStateChange?.(true);
        return true;
      }

      this.wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('[WakeLock] Screen wake lock acquired. Phone screen will stay awake.');
      this.onStateChange?.(true);

      this.wakeLock.addEventListener('release', () => {
        console.log('[WakeLock] Screen wake lock was released.');
        this.wakeLock = null;
        this.onStateChange?.(false);
      });

      return true;
    } catch (err) {
      console.warn('[WakeLock] Failed to acquire screen wake lock:', err);
      this.onStateChange?.(false);
      return false;
    }
  }

  async releaseWakeLock(): Promise<void> {
    if (this.wakeLock !== null) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        this.onStateChange?.(false);
        console.log('[WakeLock] Screen wake lock released manually.');
      } catch (err) {
        console.warn('[WakeLock] Error releasing screen wake lock:', err);
      }
    }
  }

  async toggleWakeLock(): Promise<boolean> {
    if (this.isLockActive()) {
      this.isEnabled = false;
      await this.releaseWakeLock();
      return false;
    } else {
      this.isEnabled = true;
      return await this.requestWakeLock();
    }
  }
}

