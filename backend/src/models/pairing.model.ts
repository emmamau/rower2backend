import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface PairingAttributes {
  id: string;               // UUID ou identifiant unique
  pairingCode?: string | null; // Code unique à 6 caractères alphanumériques (TTL 5 min)
  userId: string;           // Lié au compte utilisateur ou session invité
  deviceId?: string | null; // Identifiant matériel unique de la montre
  deviceToken?: string | null; // UUID v4 cryptographique persistant généré à la validation
  status: "pending" | "paired" | "revoked" | "expired";
  expiresAt: Date;          // Expiration du pairingCode (5 minutes)
  pairedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PairingModel = ModelStatic<Model<PairingAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): PairingModel => {
  const Pairing = sequelize.define<Model<PairingAttributes>>(
    "Pairing",
    {
      id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      pairingCode: {
        type: DataTypes.STRING(16),
        allowNull: true,
        unique: true,
        field: "pairing_code",
      },
      userId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: "user_id",
      },
      deviceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: "device_id",
      },
      deviceToken: {
        type: DataTypes.STRING(128),
        allowNull: true,
        unique: true,
        field: "device_token",
      },
      status: {
        type: DataTypes.STRING(32),
        defaultValue: "pending",
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "expires_at",
      },
      pairedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "paired_at",
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "revoked_at",
      },
    },
    {
      tableName: "garmin_pairings",
      timestamps: true,
      indexes: [
        { fields: ["pairingCode"] },
        { fields: ["userId"] },
        { fields: ["deviceToken"] },
        { fields: ["deviceId"] },
        { fields: ["status"] },
      ],
    }
  );

  return Pairing;
};
