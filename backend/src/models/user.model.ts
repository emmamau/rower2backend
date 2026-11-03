import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface UserAttributes {
  id: string;               // User login / code (identifiant renvoyé par la montre)
  name: string;             // Login du joueur
  totalRaces?: number;      // Nombre de courses disputées
  totalWins?: number;       // Nombre de 1ères places
  podiums?: number;         // Nombre de podiums (top 3)
  points?: number;          // Points au classement général
  bestRank?: number;        // Meilleur classement jamais obtenu (ex: 1, 2...)
  lastRank?: number;        // Classement à la précédente course
  isAdmin?: boolean;        // Rôle administrateur pour la configuration des courses
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
      points: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      bestRank: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastRank: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      isAdmin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: "rower_race_users",
      timestamps: true,
    }
  );

  return User;
};
