import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface UserAttributes {
  id: string;               // User login / code (e.g. "aB3_9Z" or custom username)
  name: string;
  email?: string;
  avatarUrl?: string;
  athleteLevel?: string;
  weightKg?: number;
  heightCm?: number;
  totalRaces: number;
  totalWins: number;
  podiums: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserModel = ModelStatic<Model<UserAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): UserModel => {
  const User = sequelize.define<Model<UserAttributes>>(
    "User",
    {
      id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      avatarUrl: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      athleteLevel: {
        type: DataTypes.STRING(32),
        defaultValue: "Racer",
      },
      weightKg: {
        type: DataTypes.FLOAT,
        defaultValue: 75.0,
      },
      heightCm: {
        type: DataTypes.FLOAT,
        defaultValue: 180.0,
      },
      totalRaces: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalWins: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      podiums: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      tableName: "rower_race_users",
      timestamps: true,
    }
  );

  return User;
};

