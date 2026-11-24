import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { RoomManager, sanitizePlayerName } from '../server/roomManager.js';
import { TripStore } from '../server/store.js';

describe('SQLite Auto-Save, Invite Links & Unique Character Rooms (PR #3)', () => {
  it('generates 192-bit invite tokens, enforces optional HOST_SECRET, and generates QR codes', async () => {
    const store = new TripStore(':memory:');
    const app = createApp({ store, hostSecret: 'maple-van' });

    const cfg = await request(app).get('/api/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body.requiresHostSecret).toBe(true);

    // Rejected without secret
    const denied = await request(app).post('/api/trips').send({ soloMode: false });
    expect(denied.status).toBe(403);

    // Accepted with valid secret
    const created = await request(app)
      .post('/api/trips')
      .send({ hostSecret: 'maple-van', soloMode: true });
    expect(created.status).toBe(201);
    expect(created.body.token.length).toBeGreaterThanOrEqual(32);
    expect(created.body.trip.soloMode).toBe(true);
    expect(created.body.trip.unlockedStopIds).toEqual(['sharon']);

    // Unknown token returns 404
    const missing = await request(app).get('/api/trips/nonexistent-token-12345678901234');
    expect(missing.status).toBe(404);

    // QR code endpoint works
    const qr = await request(app).get(`/api/trips/${created.body.token}/qr`);
    expect(qr.status).toBe(200);
    expect(qr.body.inviteUrl).toContain(`/trip/${created.body.token}`);
    expect(qr.body.dataUrl).toMatch(/^data:image\/png;base64,/);

    store.close();
  });

  it('persists stars and sequential stop unlocks in SQLite across restarts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purple-van-test-'));
    const dbPath = path.join(tmpDir, 'trips.sqlite');

    const store1 = new TripStore(dbPath);
    const trip = store1.createTrip();
    expect(trip.unlockedStopIds).toEqual(['sharon']);

    // 0 stars does NOT unlock NYC, but points still accumulate
    const zeroRes = store1.recordStopResult(trip.token, 'sharon', 0, 125)!;
    expect(zeroRes.unlockedNextStopId).toBeNull();
    expect(zeroRes.trip.unlockedStopIds).toEqual(['sharon']);
    expect(zeroRes.trip.totalScore).toBe(125);

    // 1 star unlocks NYC and adds round score
    const oneRes = store1.recordStopResult(trip.token, 'sharon', 1, 340)!;
    expect(oneRes.unlockedNextStopId).toBe('nyc');
    expect(oneRes.trip.unlockedStopIds).toEqual(['sharon', 'nyc']);
    expect(oneRes.trip.starsByStop.sharon).toBe(1);
    expect(oneRes.trip.totalScore).toBe(465);

    // 3 stars upgrades best stars without duplicate unlock and adds round score
    const threeRes = store1.recordStopResult(trip.token, 'sharon', 3, 535)!;
    expect(threeRes.newBestStars).toBe(true);
    expect(threeRes.trip.starsByStop.sharon).toBe(3);
    expect(threeRes.trip.totalScore).toBe(1000);
    store1.close();

    // Simulate server restart by opening a fresh TripStore on the same SQLite file
    const store2 = new TripStore(dbPath);
    const reloaded = store2.getTrip(trip.token)!;
    expect(reloaded.unlockedStopIds).toEqual(['sharon', 'nyc']);
    expect(reloaded.starsByStop.sharon).toBe(3);
    expect(reloaded.totalScore).toBe(1000);

    // Verify legacy 'sanjose' saves transparently migrate to 'mountainview'
    const legacy = store2.createTrip();
    store2.saveTrip({
      ...legacy,
      currentStopId: 'sanjose' as unknown as typeof legacy.currentStopId,
      unlockedStopIds: ['sharon', 'sanjose' as unknown as typeof legacy.currentStopId],
      starsByStop: { sharon: 3, ...({ sanjose: 2 } as Record<string, 1 | 2 | 3>) },
    });
    const migrated = store2.getTrip(legacy.token)!;
    expect(migrated.currentStopId).toBe('mountainview');
    expect(migrated.unlockedStopIds).toEqual(['sharon', 'mountainview']);
    expect(migrated.starsByStop.mountainview).toBe(2);

    store2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strictly enforces unique animal characters, max 3 players, Crew Lock, and safe names', () => {
    const store = new TripStore(':memory:');
    const rooms = new RoomManager(store);
    const trip = store.createTrip();

    // Rejects XSS / bad names
    expect(sanitizePlayerName('<script>alert(1)</script>')).toBeNull();
    expect(sanitizePlayerName('')).toBeNull();
    expect(sanitizePlayerName('Leo')).toBe('Leo');

    // Player 1 picks Purple Bat
    const p1 = rooms.joinRoom(trip.token, {
      socketId: 's1',
      name: 'Leo',
      preferredAnimalId: 'purple_bat',
      kidHelper: true,
    });
    expect(p1.ok).toBe(true);
    if (!p1.ok) throw new Error('expected ok');
    expect(p1.data.player.animalId).toBe('purple_bat');

    // Player 2 ALSO requests Purple Bat -> server auto-assigns a DIFFERENT unclaimed animal!
    const p2 = rooms.joinRoom(trip.token, {
      socketId: 's2',
      name: 'Maya',
      preferredAnimalId: 'purple_bat',
    });
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error('expected ok');
    expect(p2.data.player.animalId).not.toBe('purple_bat');

    // Player 2 explicitly trying to switch to Leo's Purple Bat is rejected!
    const dupSwitch = rooms.selectAnimal(trip.token, p2.data.player.playerId, 'purple_bat');
    expect(dupSwitch.ok).toBe(false);

    // Player 2 switching to unclaimed Panda succeeds
    const validSwitch = rooms.selectAnimal(trip.token, p2.data.player.playerId, 'panda');
    expect(validSwitch.ok).toBe(true);

    // Player 3 joins as Skunk
    const p3 = rooms.joinRoom(trip.token, {
      socketId: 's3',
      name: 'Ben',
      preferredAnimalId: 'skunk',
    });
    expect(p3.ok).toBe(true);

    // 4th player is strictly rejected (max 3!)
    const p4 = rooms.joinRoom(trip.token, {
      socketId: 's4',
      name: 'Stranger',
    });
    expect(p4.ok).toBe(false);

    // Driving to locked stop (Austin) is blocked until unlocked
    const lockedDrive = rooms.driveVanToStop(trip.token, 'austin');
    expect(lockedDrive.ok).toBe(false);

    // Crew Lock blocks unapproved names even if a slot opens
    const lockRes = rooms.setCrewLocked(trip.token, true);
    expect(lockRes.ok).toBe(true);
    expect(lockRes.ok && lockRes.data.trip.lockedNames).toEqual(['Leo', 'Maya', 'Ben']);

    store.close();
  });
});
