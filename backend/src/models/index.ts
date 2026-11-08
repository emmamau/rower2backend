import { Sequelize, DataTypes } from "sequelize";
import { BDD } from "../config";
import defineActivities, { ActivityModel } from "./activity.model";
import defineRaces, { RaceSessionModel } from "./race.model";
import defineUsers, { UserModel } from "./user.model";
import defineLoginRequests, { LoginRequestModel } from "./login-request.model";
import definePairings, { PairingModel } from "./pairing.model";

const connectionUrl =
  process.env.DATABASE_URL ||
  `postgres://${BDD.user}:${BDD.password}@${BDD.host}:${BDD.port}/${BDD.bdname}`;

const isLocalHost = connectionUrl.includes("localhost") || connectionUrl.includes("127.0.0.1");
const useSsl =
  process.env.DB_SSL === "true" ||
  (process.env.DB_SSL !== "false" && !isLocalHost);

export const sequelize = new Sequelize(connectionUrl, {
  dialect: "postgres",
  protocol: "postgres",
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {},
  define: {
    timestamps: true,
  },
});

export interface Database {
  Sequelize: typeof Sequelize;
  sequelize: Sequelize;
  activities: ActivityModel;
  races: RaceSessionModel;
  users: UserModel;
  loginRequests: LoginRequestModel;
  pairings: PairingModel;
}

export const db: Database = {
  Sequelize,
  sequelize,
  activities: defineActivities(sequelize, DataTypes),
  races: defineRaces(sequelize, DataTypes),
  users: defineUsers(sequelize, DataTypes),
  loginRequests: defineLoginRequests(sequelize, DataTypes),
  pairings: definePairings(sequelize, DataTypes),
};

export default db;
