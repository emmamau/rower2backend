import http from "http";
import express, { Application, Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import db from "./models";
import initRoutes from "./routes";
import socketGateway from "./websocket/socket.gateway";
import raceManager from "./services/race-manager.service";

const app: Application = express();
const server = http.createServer(app);

// Initialisation de la passerelle Socket.io
socketGateway.init(server);

const corsOptions: CorsOptions = {
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Content-Type, Authorization",
  exposedHeaders: "Authorization",
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    // Démarrer la première course publique
    await raceManager.tickPublicRace();
  })
  .catch((err: Error) => {
    console.error("Failed to sync db: " + err.message);
  });

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Rower Race Real-Time Server running on http://${HOST}:${PORT}`);
});

export default app;
