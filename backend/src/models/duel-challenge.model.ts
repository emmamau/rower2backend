import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export type DuelChallengeStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REFUSED"
  | "CANCELLED"
  | "EXPIRED"
  | "FORFEIT"
  | "COMPLETED";

export interface DuelChallengeAttributes {
  id: string;
  challengerUserId: string;
  challengerLogin: string;
  challengerName: string;
  challengedUserId: string;
  challengedLogin: string;
  challengedName: string;
  challengedEmail?: string | null;
  inviteToken?: string | null;
  slotStart: Date;
  slotEnd: Date;
  timezone: string;
  targetDistance: number;
  title?: string;
  roomId?: string;
  roomCode?: string;
  roomPin?: string;
  status: DuelChallengeStatus;
  expiresAt: Date;
  respondedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledByUserId?: string | null;
  winnerUserId?: string | null;
  forfeitUserId?: string | null;
  isDraw?: boolean;
  challengerPointsDelta?: number;
  challengedPointsDelta?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DuelChallengeModel = ModelStatic<Model<DuelChallengeAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): DuelChallengeModel => {
  const DuelChallenge = sequelize.define<Model<DuelChallengeAttributes>>(
    "DuelChallenge",
    {
      id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      challengerUserId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      challengerLogin: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      challengerName: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      challengedUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        defaultValue: "",
      },
      challengedLogin: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: "",
      },
      challengedName: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      challengedEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      inviteToken: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      slotStart: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      slotEnd: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      timezone: {
        type: DataTypes.STRING(64),
        defaultValue: "Europe/Paris",
      },
      targetDistance: {
        type: DataTypes.INTEGER,
        defaultValue: 2000,
      },
      title: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      roomId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      roomCode: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      roomPin: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(24),
        defaultValue: "PENDING",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      respondedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelledByUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      winnerUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      forfeitUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      isDraw: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      challengerPointsDelta: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      challengedPointsDelta: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      tableName: "rower_race_duel_challenges",
      timestamps: true,
      indexes: [
        { fields: ["challengerUserId"] },
        { fields: ["challengedUserId"] },
        { fields: ["status"] },
        { fields: ["slotStart"] },
        { fields: ["roomId"] },
        { fields: ["inviteToken"] },
        { fields: ["challengedEmail"] },
      ],
    }
  );

  return DuelChallenge;
};
