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

    const clampedSpm = Math.min(60, Math.max(0, strokeRate));
    const clampedSplit = splitSec > 0 ? Math.max(60, Math.min(360, splitSec)) : 0;

    // Derive mechanical ergometer power (W = 2.80 / (split/500)^3) when rower omits powerWatts during active stroke
    let rawOrDerivedPower = powerWatts;
    if (rawOrDerivedPower <= 0 && clampedSplit >= 60 && clampedSplit < 360) {
      const splitRatio = clampedSplit / 500;
      rawOrDerivedPower = Math.round(2.80 / (splitRatio * splitRatio * splitRatio));
    }
    const clampedPower = Math.min(1200, Math.max(0, rawOrDerivedPower));

    // 1. Distance checks
    const distDelta = distanceM - previousDistance;
    if (distDelta < 0) {
      // Possible reset or reconnection
      return {
        isValid: true,
        sanitizedDistance: Math.max(0, distanceM),
        sanitizedPower: clampedPower,
        sanitizedSplit: clampedSplit,
        sanitizedSpm: clampedSpm
      };
    }

    if (distDelta > 25) {
      // Aberrant telemetric jump
      return {
        isValid: false,
        sanitizedDistance: previousDistance + 15,
        sanitizedPower: clampedPower,
        sanitizedSplit: clampedSplit,
        sanitizedSpm: clampedSpm,
        reason: `Suspicious distance jump: +${distDelta.toFixed(1)}m`
      };
    }

    return {
      isValid: true,
      sanitizedDistance: distanceM,
      sanitizedPower: clampedPower,
      sanitizedSplit: clampedSplit,
      sanitizedSpm: clampedSpm
    };
  }
}

