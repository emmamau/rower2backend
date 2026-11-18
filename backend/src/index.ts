import http from "http";
import express, { Application, Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import db from "./models";
import initRoutes from "./routes";
import socketGateway from "./websocket/socket.gateway";
import raceManager from "./services/race-manager.service";
import { initializeLeagueSchema } from "./services/league-db.service";
import AdminInitService from "./services/admin-init.service";
import {
  apiGlobalLimiter,
  authRateLimiter,
  registerRateLimiter,
  garminBoostRateLimiter,
} from "./middleware/rate-limit.middleware";

const app: Application = express();
const server = http.createServer(app);

// Activer trust proxy pour que Render et reverse-proxies transmettent la vraie IP visiteur
app.set("trust proxy", 1);

// Masquer la bannière Express
app.disable("x-powered-by");

// En-têtes HTTP de sécurité de base
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

// Initialisation de la passerelle Socket.io
socketGateway.init(server);

const corsOptions: CorsOptions = {
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Content-Type, Authorization",
  exposedHeaders: "Authorization",
};

app.use(cors(corsOptions));

// Limiteur de taille de payload à 100kb pour se prémunir des attaques OOM
app.use(
  express.json({
    limit: "100kb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Rate limiters intelligents et différenciés
app.use(["/api/garmin/boost", "/boost", "/api/boost", "/api/v1/boost"], garminBoostRateLimiter);
app.use(["/api/user/register", "/api/users/register"], registerRateLimiter);
app.use(
  ["/api/user/login", "/api/users/login", "/api/garmin/pair", "/api/garmin/pair-code", "/api/garmin/pairing-code"],
  authRateLimiter
);
app.use("/api/", apiGlobalLimiter);

// Health checks
app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Welcome to Rower Race Multiplayer Real-Time API." });
});

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await db.sequelize.authenticate();
    res.status(200).json({ status: "OK", database: "connected" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: "ERROR", database: "disconnected", details: message });
  }
});

// Initialisation des routes
initRoutes(app);

// Synchronisation de la base PostgreSQL
db.sequelize
  .sync({ alter: true })
  .then(async () => {
    console.log("Synced Rower Race PostgreSQL db successfully.");
    // Initialisation du schéma d'administration, compte admin par défaut et offres
    await AdminInitService.init();
    // Chargement des paramètres dynamiques des courses publiques
    await raceManager.loadPublicRaceSettingsFromDb();
    // Initialisation du schéma de ligues paresseuses
    await initializeLeagueSchema();
    // Démarrer la première course publique si activée
    if (raceManager.isPublicRaceEnabled) {
      await raceManager.tickPublicRace();
    }
  })
  .catch((err: Error) => {
    console.error("Failed to sync db: " + err.message);
  });

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, HOST, () => {
    console.log(`Rower Race Real-Time Server running on http://${HOST}:${PORT}`);
  });
}

export default app;
