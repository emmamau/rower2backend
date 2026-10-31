export interface RowerData {
  id: number;
  sessionId?: string;
  deviceId?: string;
  timestamp: string;
  strokeRate?: number;       // strokes/min
  strokeCount?: number;      // total strokes
  avgStrokeRate?: number;    // strokes/min
  totalDistance?: number;    // meters
  instantPace?: number;      // sec/500m
  avgPace?: number;          // sec/500m
  instantPower?: number;     // Watts
  avgPower?: number;         // Watts
  resistanceLevel?: number;  // level
  totalEnergy?: number;      // kcal
  energyPerHour?: number;    // kcal/h
  energyPerMinute?: number;  // kcal/min
  heartRate?: number;        // bpm
  metabolicEq?: number;      // METs
  elapsedTime?: number;      // seconds
  remainingTime?: number;    // seconds
  rawFlags?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface HistoryResponse {
  total: number;
  records: RowerData[];
}

