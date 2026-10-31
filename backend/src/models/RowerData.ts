import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database';

export interface RowerDataAttributes {
  id: number;
  sessionId?: string;
  deviceId?: string;
  timestamp: Date;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export type RowerDataCreationAttributes = Optional<RowerDataAttributes, 'id' | 'timestamp'>;

export class RowerData extends Model<RowerDataAttributes, RowerDataCreationAttributes> implements RowerDataAttributes {
  public id!: number;
  public sessionId?: string;
  public deviceId?: string;
  public timestamp!: Date;
  public strokeRate?: number;
  public strokeCount?: number;
  public avgStrokeRate?: number;
  public totalDistance?: number;
  public instantPace?: number;
  public avgPace?: number;
  public instantPower?: number;
  public avgPower?: number;
  public resistanceLevel?: number;
  public totalEnergy?: number;
  public energyPerHour?: number;
  public energyPerMinute?: number;
  public heartRate?: number;
  public metabolicEq?: number;
  public elapsedTime?: number;
  public remainingTime?: number;
  public rawFlags?: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

RowerData.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    deviceId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    strokeRate: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Strokes per minute (0.5 unit resolution)',
    },
    strokeCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total strokes count',
    },
    avgStrokeRate: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Average strokes per minute',
    },
    totalDistance: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total distance in meters',
    },
    instantPace: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Instantaneous pace (seconds per 500m)',
    },
    avgPace: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Average pace (seconds per 500m)',
    },
    instantPower: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Instantaneous power in Watts',
    },
    avgPower: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Average power in Watts',
    },
    resistanceLevel: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Resistance level',
    },
    totalEnergy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total calories in kCal',
    },
    energyPerHour: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Calories/hour',
    },
    energyPerMinute: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Calories/min',
    },
    heartRate: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Heart rate in bpm',
    },
    metabolicEq: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Metabolic equivalent (METs)',
    },
    elapsedTime: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Elapsed time in seconds',
    },
    remainingTime: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Remaining time in seconds',
    },
    rawFlags: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Raw FTMS 16-bit flags for debugging/audit',
    },
  },
  {
    sequelize,
    tableName: 'ftms_rower_data',
    indexes: [
      {
        fields: ['sessionId'],
      },
      {
        fields: ['deviceId'],
      },
      {
        fields: ['timestamp'],
      },
    ],
  }
);

