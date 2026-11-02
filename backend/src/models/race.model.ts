import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface RaceSessionAttributes {
  id: string;               // e.g. "RACE_20261102_0815"
  title: string;
  targetDistance: number;   // meters (default 10000m)
  startTime: Date;          // Scheduled start time
  intervalMinutes: number;  // Interval between races (default 15 mins)
  status: string;           // 'waiting' | 'in_progress' | 'finished'
  totalParticipants: number;
  winnerUserId?: string;
  winnerTimeSeconds?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type RaceSessionModel = ModelStatic<Model<RaceSessionAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): RaceSessionModel => {
  const RaceSession = sequelize.define<Model<RaceSessionAttributes>>(
    "RaceSession",
    {
      id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING(128),
        defaultValue: "Rower Race Championship",
      },
      targetDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 10000,
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      intervalMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 15,
      },
      status: {
        type: DataTypes.STRING(32),
        defaultValue: "waiting",
      },
      totalParticipants: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      winnerUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      winnerTimeSeconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "rower_race_sessions",
      timestamps: true,
      indexes: [{ fields: ["startTime"] }, { fields: ["status"] }],
    }
  );

  return RaceSession;
};

