import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getNextStopId, isValidStopId } from '../shared/stops.js';
import type { GamePace, StopId, TripSave } from '../shared/types.js';

export interface CreateTripOptions {
  soloMode?: boolean;
  pace?: GamePace;
}

export class TripStore {
  private readonly db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.resolve(process.env.DATA_DIR ?? './data', 'trips.sqlite');

    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trips (
        token TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Generates a 192-bit cryptographically random URL-safe invite token.
   */
  static generateToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  static isValidTokenFormat(token: unknown): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(token);
  }

  createTrip(options: CreateTripOptions = {}): TripSave {
    const now = new Date().toISOString();
    const token = TripStore.generateToken();
    const trip: TripSave = {
      token,
      createdAt: now,
      updatedAt: now,
      currentStopId: 'sharon',
      unlockedStopIds: ['sharon'],
      starsByStop: {},
      crewLocked: false,
      lockedNames: [],
      pace: options.pace === 'rush' ? 'rush' : 'cozy',
      soloMode: Boolean(options.soloMode),
      soloAiHelper: false,
    };

    const stmt = this.db.prepare(
      'INSERT INTO trips (token, state_json, updated_at) VALUES (?, ?, ?)',
    );
    stmt.run(trip.token, JSON.stringify(trip), trip.updatedAt);
    return trip;
  }

  getTrip(token: string): TripSave | null {
    if (!TripStore.isValidTokenFormat(token)) return null;
    const stmt = this.db.prepare('SELECT state_json FROM trips WHERE token = ?');
    const row = stmt.get(token) as { state_json: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.state_json) as TripSave;
      if (!isValidStopId(parsed.currentStopId)) {
        parsed.currentStopId = 'sharon';
      }
      if (!Array.isArray(parsed.unlockedStopIds) || parsed.unlockedStopIds.length === 0) {
        parsed.unlockedStopIds = ['sharon'];
      }
      return parsed;
    } catch {
      return null;
    }
  }

  saveTrip(trip: TripSave): TripSave {
    const updated: TripSave = {
      ...trip,
      updatedAt: new Date().toISOString(),
    };
    const stmt = this.db.prepare(
      'UPDATE trips SET state_json = ?, updated_at = ? WHERE token = ?',
    );
    stmt.run(JSON.stringify(updated), updated.updatedAt, updated.token);
    return updated;
  }

  /**
   * Records stars earned on a stop and unlocks the next destination if stars >= 1.
   */
  recordStopResult(
    token: string,
    stopId: StopId,
    starsEarned: 0 | 1 | 2 | 3,
  ): { trip: TripSave; unlockedNextStopId: StopId | null; newBestStars: boolean } | null {
    const trip = this.getTrip(token);
    if (!trip) return null;

    let unlockedNextStopId: StopId | null = null;
    let newBestStars = false;

    if (starsEarned >= 1) {
      const earned = starsEarned as 1 | 2 | 3;
      const prevBest = trip.starsByStop[stopId] ?? 0;
      if (earned > prevBest) {
        trip.starsByStop[stopId] = earned;
        newBestStars = true;
      }

      const nextStop = getNextStopId(stopId);
      if (nextStop && !trip.unlockedStopIds.includes(nextStop)) {
        trip.unlockedStopIds.push(nextStop);
        unlockedNextStopId = nextStop;
      }
    }

    const saved = this.saveTrip(trip);
    return { trip: saved, unlockedNextStopId, newBestStars };
  }

  close(): void {
    this.db.close();
  }
}
