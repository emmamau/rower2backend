import express, { Application, Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import db from "./models";
import initRoutes from "./routes";

const app: Application = express();

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
  res.json({ message: "Welcome to Rower Race Multiplayer API." });
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

// Initialisation des routes suivant le pattern cnamWeb
initRoutes(app);

// Synchronisation de la base PostgreSQL
db.sequelize
  .sync({ alter: true })
  .then(() => {
    console.log("Synced Rower Race PostgreSQL db successfully.");
  })
  .catch((err: Error) => {
    console.error("Failed to sync db: " + err.message);
  });

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Rower Race Server is running on http://${HOST}:${PORT}`);
});

export default app;
