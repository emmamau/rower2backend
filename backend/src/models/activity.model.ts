import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface ActivityAttributes {
  id: string;               // composite unique id: `${activityId}_${userId}`
  activityId: string;       // identifier of the race session
  userId: string;           // identifiant de la montre
  userName?: string;        // login du joueur
  isBot?: boolean;          // true si c'est un bot virtuel
  raceMode: string;         // 'race' | 'solo'
  targetDistance: number;   // default 10000m
  status: string;           // 'waiting' | 'in_progress' | 'paused' | 'abandoned' | 'finished' | 'out_of_time'

  // Distance computation
  initialDistance: number;  // Distance at start of activity on the rower (meters)
  currentDistance: number;  // Raw current distance reading from rower (meters)
  netDistance: number;      // currentDistance - initialDistance (always starts at 0)
  progressPercent: number;  // (netDistance / targetDistance) * 100

  // Latest stroke data
  lastStrokeRate: number;   // strokes per minute
  lastStrokeCount: number;  // total strokes count
  lastPower: number;        // instant Watts
  lastPace: number;         // sec / 500m
  lastHeartRate: number;    // bpm
  lastResistance: number;   // level

  // Summary / Accumulated stats for the activity
  avgPower: number;         // average watts
  avgPace: number;          // average seconds per 500m
  avgStrokeRate: number;    // average SPM
  totalStrokes: number;     // strokes during this session
  totalEnergy: number;      // calories kcal
  elapsedTime: number;      // total active seconds
  avgSpeedKmh: number;      // computed average km/h

  // Leaderboard / ranking
  finalRank?: number;
  finishedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ActivityModel = ModelStatic<Model<ActivityAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): ActivityModel => {
  const Activity = sequelize.define<Model<ActivityAttributes>>(
    "Activity",
    {
      id: {
        type: DataTypes.STRING(128),
        primaryKey: true,
      },
      activityId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      userId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      userName: {
        type: DataTypes.STRING(128),
        defaultValue: "Rower Athlete",
      },
      isBot: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      raceMode: {
        type: DataTypes.STRING(16),
        defaultValue: "race",
      },
      targetDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 10000,
      },
      status: {
        type: DataTypes.STRING(32),
        defaultValue: "waiting",
      },
      initialDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      currentDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      netDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      progressPercent: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },
      lastStrokeRate: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },
      lastStrokeCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastPower: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastPace: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastHeartRate: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastResistance: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      avgPower: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      avgPace: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      avgStrokeRate: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },
      totalStrokes: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalEnergy: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      elapsedTime: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      avgSpeedKmh: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },
      finalRank: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      finishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "rower_race_activities",
      timestamps: true,
      indexes: [
        { fields: ["activityId"] },
        { fields: ["userId"] },
        { fields: ["status"] },
        { fields: ["netDistance"] },
      ],
    }
  );

  return Activity;
};
