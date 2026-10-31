import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sequelize } from './database';
import { RowerData } from './models/RowerData';
import { User } from './models/User';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', details: (error as Error).message });
  }
});

// Seed default user if not exists
async function ensureDefaultUser(): Promise<User> {
  let user = await User.findOne({ where: { email: 'athlete@garmin-rower.app' } });
  if (!user) {
    user = await User.create({
      email: 'athlete@garmin-rower.app',
      name: 'Emma Rower Athlete',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
      athleteLevel: 'Advanced Competitor',
      weightKg: 72.5,
      heightCm: 178,
      maxHeartRate: 195,
      vo2MaxEstimate: 54.2,
    });
  }
  return user;
}

// User Profile API (Current connected user)
app.get('/api/user/me', async (_req: Request, res: Response) => {
  try {
    const user = await ensureDefaultUser();
    return res.json(user);
  } catch (error) {
    console.error('Error fetching current user:', error);
    return res.status(500).json({ error: 'Failed to retrieve user profile', details: (error as Error).message });
  }
});

// Update user profile
app.put('/api/user/me', async (req: Request, res: Response) => {
  try {
    const user = await ensureDefaultUser();
    const { name, weightKg, heightCm, athleteLevel, maxHeartRate, vo2MaxEstimate } = req.body;

    await user.update({
      name: name ?? user.name,
      weightKg: weightKg !== undefined ? Number(weightKg) : user.weightKg,
      heightCm: heightCm !== undefined ? Number(heightCm) : user.heightCm,
      athleteLevel: athleteLevel ?? user.athleteLevel,
      maxHeartRate: maxHeartRate !== undefined ? Number(maxHeartRate) : user.maxHeartRate,
      vo2MaxEstimate: vo2MaxEstimate !== undefined ? Number(vo2MaxEstimate) : user.vo2MaxEstimate,
    });

    return res.json(user);
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({ error: 'Failed to update user profile', details: (error as Error).message });
  }
});

// Post single FTMS record
app.post('/api/rower/data', async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    if (!payload) {
      return res.status(400).json({ error: 'Payload body is required' });
    }

    const record = await RowerData.create({
      ...payload,
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    });

    return res.status(201).json({ success: true, id: record.id });
  } catch (error) {
    console.error('Error saving rower data:', error);
    return res.status(500).json({ error: 'Failed to record rower data', details: (error as Error).message });
  }
});

// Post batch FTMS records (useful for buffer syncing from watch)
app.post('/api/rower/batch', async (req: Request, res: Response) => {
  try {
    const records = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Array of records expected' });
    }

    const formattedRecords = records.map((item) => ({
      ...item,
      timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
    }));

    const inserted = await RowerData.bulkCreate(formattedRecords);
    return res.status(201).json({ success: true, count: inserted.length });
  } catch (error) {
    console.error('Error inserting batch rower data:', error);
    return res.status(500).json({ error: 'Failed to insert batch rower data', details: (error as Error).message });
  }
});

// Get latest rower metrics
app.get('/api/rower/latest', async (req: Request, res: Response) => {
  try {
    const { sessionId, deviceId } = req.query;
    const whereClause: any = {};
    if (sessionId) whereClause.sessionId = sessionId;
    if (deviceId) whereClause.deviceId = deviceId;

    const latest = await RowerData.findOne({
      where: whereClause,
      order: [['timestamp', 'DESC']],
    });

    if (!latest) {
      return res.status(404).json({ message: 'No rower data found' });
    }

    return res.json(latest);
  } catch (error) {
    console.error('Error fetching latest rower data:', error);
    return res.status(500).json({ error: 'Failed to fetch latest data' });
  }
});

// Get records with pagination & session filtering
app.get('/api/rower/history', async (req: Request, res: Response) => {
  try {
    const { sessionId, limit = 100, offset = 0 } = req.query;
    const whereClause: any = {};
    if (sessionId) whereClause.sessionId = sessionId;

    const { count, rows } = await RowerData.findAndCountAll({
      where: whereClause,
      order: [['timestamp', 'DESC']],
      limit: Math.min(Number(limit), 1000),
      offset: Number(offset),
    });

    return res.json({ total: count, records: rows });
  } catch (error) {
    console.error('Error fetching rower history:', error);
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Initialize database & start server
async function startServer() {
  try {
    console.log('Connecting to PostgreSQL database via Sequelize...');
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');

    // Automatically sync schema (alter: true creates/updates tables without dropping)
    await sequelize.sync({ alter: true });
    console.log('All models were synchronized successfully.');

    // Ensure initial default athlete
    await ensureDefaultUser();

    app.listen(port, () => {
      console.log(`Rower backend server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Unable to connect to the database or start server:', error);
    process.exit(1);
  }
}

startServer();
