import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface UserAttributes {
  id: string;               // Identifiant unique (login ou ID montre/généré)
  name: string;             // Nom d'affichage ou login du joueur
  login?: string;           // Login unique de l'abonné (sert pour Garmin & web)
  email?: string;           // Adresse email de l'abonné
  lastName?: string;        // Nom de famille
  nom?: string;             // Nom de famille (alias français)
  firstName?: string;       // Prénom
  prenom?: string;          // Prénom (alias français)
  birthYear?: number;       // Année de naissance
  anneeNaissance?: number;  // Année de naissance (alias français)
  gender?: string;          // Sexe ('M', 'F', 'Autre')
  sexe?: string;            // Sexe (alias français)
  country?: string;         // Pays de résidence
  pays?: string;            // Pays de résidence (alias français)
  passwordHash?: string;    // Hash du mot de passe
  passwordSalt?: string;    // Sel cryptographique du mot de passe
  isSubscriber?: boolean;   // Statut abonné (droit de créer des salons privés)
  subscriptionTier?: 'free' | 'intermediate' | 'premium'; // 'free' (gratuit) | 'intermediate' (5.99€) | 'premium' (8.99€)
  subscriptionStatus?: string; // 'active' | 'cancelled' | 'expired' | 'none'
  lemonCustomerId?: string;
  lemonSubscriptionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  isConfirmed?: boolean;    // Confirmation de l'inscription via montre Garmin
  watchUserId?: string;     // Identifiant renvoyé par la montre Garmin
  watchModel?: string;      // Modèle de montre Garmin (ex: Fenix 7, Forerunner 965...)
  rowerModel?: string;      // Modèle de rameur connecté (ex: SmartRow, Concept2 PM5, FTMS...)
  resetPasswordToken?: string;   // Token de réinitialisation de mot de passe
  resetPasswordExpires?: Date;   // Expiration du token de réinitialisation
  totalRaces?: number;      // Nombre de courses disputées
  totalWins?: number;       // Nombre de 1ères places
  podiums?: number;         // Nombre de podiums (top 3)
  points?: number;          // Points au classement général
  league?: string;          // Division de ligue (bronze, silver, gold, platinum, diamond)
  bestRank?: number;        // Meilleur classement jamais obtenu (ex: 1, 2...)
  lastRank?: number;        // Classement à la précédente course
  isAdmin?: boolean;        // Rôle administrateur (EmmaRacer en dur)
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
      login: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
      email: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      lastName: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      nom: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      firstName: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      prenom: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      birthYear: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      anneeNaissance: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      gender: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      sexe: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      pays: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      passwordHash: {
        type: DataTypes.STRING(256),
        allowNull: true,
      },
      passwordSalt: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      isSubscriber: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      subscriptionTier: {
        type: DataTypes.STRING(32),
        defaultValue: "free",
      },
      subscriptionStatus: {
        type: DataTypes.STRING(32),
        defaultValue: "none",
      },
      lemonCustomerId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      lemonSubscriptionId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      stripeCustomerId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      stripeSubscriptionId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      watchModel: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      rowerModel: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      isConfirmed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      watchUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      resetPasswordToken: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      resetPasswordExpires: {
        type: DataTypes.DATE,
        allowNull: true,
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
      league: {
        type: DataTypes.STRING(32),
        defaultValue: "bronze",
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
      indexes: [
        { fields: ["login"], unique: true },
        { fields: ["email"] },
        { fields: ["watchUserId"] }
      ]
    }
  );

  return User;
};
