const test = require('node:test');
const assert = require('node:assert/strict');

const { RaceManager } = require('../dist/services/race-manager.service');
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test('1. Race completes immediately when all humans finish, and remaining bots have their time estimated based on pace', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Bot Extrapolation Test',
    targetDistance: 1000,
    hostUserId: 'organizer_user_1',
    maxDurationMinutes: 15,
  });

  const raceId = race.id;
  race.status = 'RUNNING';
  const startMs = Date.now() - 200 * 1000;
  race.startedAt = new Date(startMs);

  // 1. Organizer finishes at 1000m in 200s (allure 1:40 = 100s/500m)
  userStore.recordActivity({
    id: `${raceId}_organizer_user_1`,
    activityId: raceId,
    userId: 'organizer_user_1',
    userName: 'Organizer',
    status: 'finished',
    netDistance: 1000,
    currentDistance: 1000,
    targetDistance: 1000,
    elapsedTime: 200,
    finishedAt: new Date(startMs + 200 * 1000),
    isBot: false,
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // 2. Fast Bot 1 already finished before human (at 180s, allure 1:30 = 90s/500m)
  userStore.recordActivity({
    id: `${raceId}_bot_fast`,
    activityId: raceId,
    userId: 'bot_fast',
    userName: 'Fast Bot',
    status: 'finished',
    netDistance: 1000,
    currentDistance: 1000,
    targetDistance: 1000,
    avgPace: 90,
    elapsedTime: 180,
    finishedAt: new Date(startMs + 180 * 1000),
    isBot: true,
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // 3. Slower Bot 2 still in progress at 700m with allure 2:30 (150s/500m)
  userStore.recordActivity({
    id: `${raceId}_bot_slow`,
    activityId: raceId,
    userId: 'bot_slow',
    userName: 'Slow Bot',
    status: 'in_progress',
    netDistance: 700,
    currentDistance: 700,
    targetDistance: 1000,
    avgPace: 150,
    elapsedTime: 210,
    isBot: true,
    createdAt: new Date(startMs),
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Tick the private races
  await raceManager.tickPrivateRaces();

  // The race must be COMPLETED immediately because all humans have finished!
  assert.equal(race.status, 'COMPLETED');

  // Check the slow bot's estimated time:
  // Target: 1000m, Pace: 150s/500m -> Estimated total time = 1000 * 150 / 500 = 300 seconds
  const slowBotAct = userStore.findActivityById(`${raceId}_bot_slow`);
  assert.equal(slowBotAct.status, 'finished');
  assert.equal(slowBotAct.netDistance, 1000);
  assert.equal(slowBotAct.elapsedTime, 300);
  assert.equal(slowBotAct.isEstimated, true);

  // Check ranking order:
  // 1. Fast Bot (180s - real)
  // 2. Organizer (200s - real)
  // 3. Slow Bot (300s - estimated)
  const ranking = race.finalRanking;
  assert.ok(Array.isArray(ranking));
  assert.equal(ranking.length, 3);
  assert.equal(ranking[0].userId, 'bot_fast');
  assert.equal(ranking[0].rank, 1);
  assert.equal(ranking[0].isEstimated, false);

  assert.equal(ranking[1].userId, 'organizer_user_1');
  assert.equal(ranking[1].rank, 2);

  assert.equal(ranking[2].userId, 'bot_slow');
  assert.equal(ranking[2].rank, 3);
  assert.equal(ranking[2].isEstimated, true);
  assert.equal(ranking[2].estimatedTime, 300);
});

test('2. Player who paused 40s is NOT abandoned, but > 60s IS marked abandoned (DNF)', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Inactivity Abandon Test',
    targetDistance: 1000,
    hostUserId: 'host_inactive_test',
    maxDurationMinutes: 15,
  });

  const raceId = race.id;
  race.status = 'RUNNING';
  const startMs = Date.now() - 90 * 1000;
  race.startedAt = new Date(startMs);

  // Player A: paused 40 seconds ago (< 60s -> NOT abandoned)
  const paused40sAgo = new Date(Date.now() - 40 * 1000);
  userStore.recordActivity({
    id: `${raceId}_paused_40s_racer`,
    activityId: raceId,
    userId: 'paused_40s_racer',
    userName: 'Brief Pause Racer',
    status: 'in_progress',
    netDistance: 300,
    targetDistance: 1000,
    elapsedTime: 50,
    isBot: false,
    updatedAt: paused40sAgo,
    lastRowedAtMs: paused40sAgo.getTime(),
    lastTelemetryAtMs: paused40sAgo.getTime(),
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Player B: stopped rowing 70 seconds ago (> 60s -> IS abandoned)
  const stopped70sAgo = new Date(Date.now() - 70 * 1000);
  userStore.recordActivity({
    id: `${raceId}_stopped_70s_racer`,
    activityId: raceId,
    userId: 'stopped_70s_racer',
    userName: 'Quit Racer',
    status: 'in_progress',
    netDistance: 120,
    targetDistance: 1000,
    elapsedTime: 20,
    isBot: false,
    updatedAt: stopped70sAgo,
    lastRowedAtMs: stopped70sAgo.getTime(),
    lastTelemetryAtMs: stopped70sAgo.getTime(),
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Also have an active bot still rowing
  userStore.recordActivity({
    id: `${raceId}_active_bot`,
    activityId: raceId,
    userId: 'active_bot',
    userName: 'Active Bot',
    status: 'in_progress',
    netDistance: 400,
    currentDistance: 400,
    targetDistance: 1000,
    avgPace: 120,
    elapsedTime: 72,
    isBot: true,
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Tick
  await raceManager.tickPrivateRaces();

  // Player A (40s pause) must still be in_progress
  const actA = userStore.findActivityById(`${raceId}_paused_40s_racer`);
  assert.equal(actA.status, 'in_progress');

  // Player B (70s stopped) must have been marked as abandoned
  const actB = userStore.findActivityById(`${raceId}_stopped_70s_racer`);
  assert.equal(actB.status, 'abandoned');

  // Race is still running because Player A is in_progress
  assert.equal(race.status, 'RUNNING');
});

test('3. Organizer can manually stop the race while bots are still rowing', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Manual Stop Test',
    targetDistance: 1000,
    hostUserId: 'host_manual_stop',
    maxDurationMinutes: 15,
  });

  const raceId = race.id;
  race.status = 'RUNNING';
  race.startedAt = new Date(Date.now() - 20 * 1000);

  // Host finished
  userStore.recordActivity({
    id: `${raceId}_host_manual_stop`,
    activityId: raceId,
    userId: 'host_manual_stop',
    userName: 'Host',
    status: 'finished',
    netDistance: 1000,
    targetDistance: 1000,
    elapsedTime: 200,
    isBot: false,
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Bot at 500m
  userStore.recordActivity({
    id: `${raceId}_bot_manual`,
    activityId: raceId,
    userId: 'bot_manual',
    userName: 'Bot',
    status: 'in_progress',
    netDistance: 500,
    currentDistance: 500,
    targetDistance: 1000,
    avgPace: 120,
    elapsedTime: 100,
    isBot: true,
    update: async function (fields) { Object.assign(this, fields); },
    get: function (k) { return this[k]; },
  });

  // Organizer stops the race
  const ranking = await raceManager.finishRace(raceId, false, 'organizer_stopped');

  assert.equal(race.status, 'STOPPED');
  assert.ok(Array.isArray(ranking));
  assert.ok(ranking.length >= 2);
});
