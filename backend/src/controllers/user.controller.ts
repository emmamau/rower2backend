import { Request, Response } from "express";
import db from "../models";

const Users = db.users;

/**
 * GET /api/user/profile/:userId
 */
export const getUserProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    let user = await Users.findByPk(userId);

    if (!user) {
      user = await Users.create({
        id: userId,
        name: `Racer_${userId.slice(-4)}`,
        athleteLevel: "Racer",
        weightKg: 75.0,
        heightCm: 180.0,
        totalRaces: 0,
        totalWins: 0,
        podiums: 0,
      });
    }

    res.status(200).json(user);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur récupération utilisateur: " + message });
  }
};

/**
 * PUT /api/user/profile/:userId
 */
export const updateUserProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, avatarUrl, athleteLevel, weightKg, heightCm } = req.body;

    let user = await Users.findByPk(userId);
    if (!user) {
      user = await Users.create({
        id: userId,
        name: name || `Racer_${userId.slice(-4)}`,
        email,
        avatarUrl,
        athleteLevel,
        weightKg: weightKg !== undefined ? Number(weightKg) : 75.0,
        heightCm: heightCm !== undefined ? Number(heightCm) : 180.0,
        totalRaces: 0,
        totalWins: 0,
        podiums: 0,
      });
    } else {
      await user.update({
        name: name ?? (user.get("name") as string),
        email: email ?? (user.get("email") as string),
        avatarUrl: avatarUrl ?? (user.get("avatarUrl") as string),
        athleteLevel: athleteLevel ?? (user.get("athleteLevel") as string),
        weightKg: weightKg !== undefined ? Number(weightKg) : (user.get("weightKg") as number),
        heightCm: heightCm !== undefined ? Number(heightCm) : (user.get("heightCm") as number),
      });
    }

    res.status(200).json(user);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur mise à jour utilisateur: " + message });
  }
};

export default {
  getUserProfile,
  updateUserProfile,
};
