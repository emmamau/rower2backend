import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database';

export interface UserAttributes {
  id: number;
  email: string;
  name: string;
  avatarUrl?: string;
  athleteLevel?: string; // 'beginner' | 'intermediate' | 'advanced' | 'elite'
  weightKg?: number;
  heightCm?: number;
  maxHeartRate?: number;
  vo2MaxEstimate?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserCreationAttributes = Optional<UserAttributes, 'id'>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: number;
  public email!: string;
  public name!: string;
  public avatarUrl?: string;
  public athleteLevel?: string;
  public weightKg?: number;
  public heightCm?: number;
  public maxHeartRate?: number;
  public vo2MaxEstimate?: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    avatarUrl: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    athleteLevel: {
      type: DataTypes.STRING(32),
      defaultValue: 'intermediate',
    },
    weightKg: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    heightCm: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    maxHeartRate: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    vo2MaxEstimate: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'users',
  }
);

