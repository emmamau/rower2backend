import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface SubscriptionPlanAttributes {
  id?: number;
  code: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  maxBotsPerRace: number;
  maxRaceDistanceM: number;
  maxPlayersPerRoom: number;
  maxConcurrentRooms: number;
  maxRoomsPerWeek: number;
  canCreateDuel1v1: boolean;
  canScheduleRaces: boolean;
  isActive: boolean;
  isPioneerEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SubscriptionPlanModel = ModelStatic<Model<SubscriptionPlanAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): SubscriptionPlanModel => {
  const SubscriptionPlan = sequelize.define<Model<SubscriptionPlanAttributes>>(
    "SubscriptionPlan",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      priceMonthly: {
        type: DataTypes.DECIMAL(10, 2),
        field: "price_monthly",
        defaultValue: 0,
      },
      priceYearly: {
        type: DataTypes.DECIMAL(10, 2),
        field: "price_yearly",
        defaultValue: 0,
      },
      maxBotsPerRace: {
        type: DataTypes.INTEGER,
        field: "max_bots_per_race",
        defaultValue: 1,
      },
      maxRaceDistanceM: {
        type: DataTypes.INTEGER,
        field: "max_race_distance_m",
        defaultValue: 2000,
      },
      maxPlayersPerRoom: {
        type: DataTypes.INTEGER,
        field: "max_players_per_room",
        defaultValue: 2,
      },
      maxConcurrentRooms: {
        type: DataTypes.INTEGER,
        field: "max_concurrent_rooms",
        defaultValue: 1,
      },
      maxRoomsPerWeek: {
        type: DataTypes.INTEGER,
        field: "max_rooms_per_week",
        defaultValue: 5,
      },
      canCreateDuel1v1: {
        type: DataTypes.BOOLEAN,
        field: "can_create_duel_1v1",
        defaultValue: true,
      },
      canScheduleRaces: {
        type: DataTypes.BOOLEAN,
        field: "can_schedule_races",
        defaultValue: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        field: "is_active",
        defaultValue: true,
      },
      isPioneerEnabled: {
        type: DataTypes.BOOLEAN,
        field: "is_pioneer_enabled",
        // Valeur initiale héritée de l'ancien interrupteur global LAUNCH_PIONEER_MODE
        defaultValue: process.env.LAUNCH_PIONEER_MODE !== "false",
      },
    },
    {
      tableName: "subscription_plans",
      timestamps: true,
      indexes: [
        { fields: ["code"], unique: true },
      ],
    }
  );

  return SubscriptionPlan;
};
