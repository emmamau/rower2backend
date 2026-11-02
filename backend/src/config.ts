export interface DatabaseConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  bdname: string;
}

export interface AppConfig {
  BDD: DatabaseConfig;
  defaultRaceDistanceMeters: number;
  raceIntervalMinutes: number;
}

export const config: AppConfig = {
  BDD: {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || "5432",
    user: process.env.DB_USER || "rower_user",
    password: process.env.DB_PASSWORD || "rower_password",
    bdname: process.env.DB_NAME || "rower_db",
  },
  defaultRaceDistanceMeters: Number(process.env.DEFAULT_RACE_DISTANCE) || 10000,
  raceIntervalMinutes: Number(process.env.RACE_INTERVAL_MINUTES) || 15,
};

export const { BDD } = config;
export default config;

