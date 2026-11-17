import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface PublicRaceSettingsAttributes {
  id: number;
  isEnabled: boolean;
  raceDistanceM: number;
  maxDurationSec: number;
  maxPlayers: number;
  botCount: number;
  interRaceDelaySec: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PublicRaceSettingsModel = ModelStatic<Model<PublicRaceSettingsAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): PublicRaceSettingsModel => {
  const PublicRaceSettings = sequelize.define<Model<PublicRaceSettingsAttributes>>(
    "PublicRaceSettings",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        defaultValue: 1,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        field: "is_enabled",
        defaultValue: true,
      },
      raceDistanceM: {
        type: DataTypes.INTEGER,
        field: "race_distance_m",
        defaultValue: 1000,
      },
      maxDurationSec: {
        type: DataTypes.INTEGER,
        field: "max_duration_sec",
        defaultValue: 600,
      },
      maxPlayers: {
        type: DataTypes.INTEGER,
        field: "max_players",
        defaultValue: 6,
      },
      botCount: {
        type: DataTypes.INTEGER,
        field: "bot_count",
        defaultValue: 2,
      },
      interRaceDelaySec: {
        type: DataTypes.INTEGER,
        field: "inter_race_delay_sec",
        defaultValue: 120,
      },
    },
    {
      tableName: "public_race_settings",
      timestamps: true,
    }
  );

  return PublicRaceSettings;
};
