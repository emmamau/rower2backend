import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface LoginRequestAttributes {
  id: string;               // Token de session
  userId: string;           // Identifiant de la montre
  login: string;            // Login saisi sur le front
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: Date;
  respondedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type LoginRequestModel = ModelStatic<Model<LoginRequestAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): LoginRequestModel => {
  const LoginRequest = sequelize.define<Model<LoginRequestAttributes>>(
    "LoginRequest",
    {
      id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      login: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(32),
        defaultValue: "pending",
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      respondedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "rower_race_login_requests",
      timestamps: true,
      indexes: [{ fields: ["userId"] }, { fields: ["status"] }],
    }
  );

  return LoginRequest;
};

