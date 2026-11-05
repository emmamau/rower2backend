export interface TelemetryPayload {
  raceId: string;
  userId: string;
  seq?: number;
  timestamp: number;
  metrics: {
    distanceM: number;
    splitSec: number;
    powerWatts: number;
    strokeRate: number;
    heartRate?: number;
  };
}

export interface ValidationResult {
  isValid: boolean;
  sanitizedDistance: number;
  sanitizedPower: number;
  sanitizedSplit: number;
  sanitizedSpm: number;
  reason?: string;
}

export class TelemetryValidator {
  /**
   * Biomechanical sanity checks:
   * - Power: 0 to 1200 Watts (human mechanical burst limit on indoor ergometer)
   * - Stroke Rate: 10 to 60 SPM
   * - Split: 60s (WR world record ~1:10) to 360s
   * - Distance delta: max 18 meters per stroke (humanly impossible beyond 16m at elite level)
   */
  public static validate(
    payload: TelemetryPayload,
    previousDistance: number = 0,
    previousTimeSec: number = 0
  ): ValidationResult {
    const { distanceM, splitSec, powerWatts, strokeRate } = payload.metrics;

    // 1. Distance checks
    const distDelta = distanceM - previousDistance;
    if (distDelta < 0) {
      // Possible reset or reconnection
      return {
        isValid: true,
        sanitizedDistance: Math.max(0, distanceM),
        sanitizedPower: Math.min(1200, Math.max(0, powerWatts)),
        sanitizedSplit: Math.max(60, splitSec),
        sanitizedSpm: Math.min(60, Math.max(0, strokeRate))
      };
    }

    if (distDelta > 25) {
      // Aberrant telemetric jump
      return {
        isValid: false,
        sanitizedDistance: previousDistance + 15,
        sanitizedPower: Math.min(1200, Math.max(0, powerWatts)),
        sanitizedSplit: Math.max(60, splitSec),
        sanitizedSpm: Math.min(60, Math.max(0, strokeRate)),
        reason: `Suspicious distance jump: +${distDelta.toFixed(1)}m`
      };
    }

    // 2. Power check
    const clampedPower = Math.min(1200, Math.max(0, powerWatts));

    // 3. Cadence check
    const clampedSpm = Math.min(60, Math.max(0, strokeRate));

    // 4. Split check
    const clampedSplit = splitSec > 0 ? Math.max(60, Math.min(360, splitSec)) : 0;

    return {
      isValid: true,
      sanitizedDistance: distanceM,
      sanitizedPower: clampedPower,
      sanitizedSplit: clampedSplit,
      sanitizedSpm: clampedSpm
    };
  }
}

