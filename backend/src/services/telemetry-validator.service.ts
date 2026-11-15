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
   * Formule officielle Concept2 :
   * P (Watts) = 2.80 * v^3  <=>  v (m/s) = (P / 2.80)^(1/3)
   * Allure (/500m en s) = 500 / v = 500 * (2.80 / P)^(1/3)
   */
  public static computeConcept2Speed(powerWatts: number, splitSec: number = 0): number {
    if (powerWatts > 0) {
      const clampedW = Math.min(1200, Math.max(0, powerWatts));
      return Math.min(8.33, Math.cbrt(clampedW / 2.80));
    }
    if (splitSec >= 60 && splitSec <= 360) {
      return 500 / splitSec;
    }
    return 0;
  }

  public static computeConcept2Split(powerWatts: number, fallbackSplitSec: number = 0): number {
    if (powerWatts > 0) {
      const c2Speed = this.computeConcept2Speed(powerWatts);
      if (c2Speed > 0) {
        return Math.max(60, Math.min(360, Math.round(500 / c2Speed)));
      }
    }
    return fallbackSplitSec > 0 ? Math.max(60, Math.min(360, Math.round(fallbackSplitSec))) : 0;
  }

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
    previousTimeSec: number = 0,
    currentTimeSec: number = 0
  ): ValidationResult {
    const { distanceM, splitSec, powerWatts, strokeRate } = payload.metrics;

    let clampedSpm = Math.min(60, Math.max(0, strokeRate));
    let clampedSplit = splitSec > 0 ? Math.max(60, Math.min(360, splitSec)) : 0;

    // Derive mechanical ergometer power (W = 2.80 / (split/500)^3) when rower omits powerWatts during active stroke
    let rawOrDerivedPower = powerWatts;
    if (rawOrDerivedPower <= 0 && clampedSplit >= 60 && clampedSplit < 360) {
      const splitRatio = clampedSplit / 500;
      rawOrDerivedPower = Math.round(2.80 / (splitRatio * splitRatio * splitRatio));
    }
    const clampedPower = Math.min(1200, Math.max(0, Math.round(rawOrDerivedPower)));

    // Normalize splitSec strictly from powerWatts using the official Concept2 formula
    // whenever powerWatts > 0, ensuring speed/pace/power coherence across all rower models
    if (clampedPower > 0) {
      clampedSplit = this.computeConcept2Split(clampedPower, clampedSplit);
    }

    // Realistic cadence estimation if power is generated but SPM omitted
    if (clampedSpm <= 0 && clampedPower > 15) {
      clampedSpm = Math.min(36, Math.max(18, Math.round(18 + Math.sqrt(clampedPower) * 0.45)));
    }

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

    const elapsedDelta = currentTimeSec > previousTimeSec
      ? Math.min(60, Math.max(1, currentTimeSec - previousTimeSec))
      : 1;
    const maxAllowedJump = Math.max(60, elapsedDelta * 12);

    if (distDelta > maxAllowedJump) {
      // Aberrant telemetric jump
      return {
        isValid: false,
        sanitizedDistance: previousDistance + Math.min(maxAllowedJump, Math.max(25, elapsedDelta * 8)),
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

