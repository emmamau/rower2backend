const test = require('node:test');
const assert = require('node:assert/strict');
const { TelemetryValidator } = require('../dist/services/telemetry-validator.service');

test('derives mechanical power in Watts when powerWatts is 0 during active rowing split', () => {
  const res = TelemetryValidator.validate(
    {
      raceId: 'RACE_TEST',
      userId: 'u1',
      seq: 5,
      timestamp: Date.now(),
      metrics: {
        distanceM: 50,
        splitSec: 100, // 1:40 / 500m -> 2.80 / (100/500)^3 = 350W
        powerWatts: 0,
        strokeRate: 28,
        heartRate: 150
      }
    },
    40,
    15
  );

  assert.equal(res.isValid, true);
  assert.equal(res.sanitizedPower, 350);
});

test('keeps powerWatts at 0 when rower is idle (splitSec is 0 and powerWatts is 0)', () => {
  const res = TelemetryValidator.validate(
    {
      raceId: 'RACE_TEST',
      userId: 'u1',
      seq: 0,
      timestamp: Date.now(),
      metrics: {
        distanceM: 0,
        splitSec: 0,
        powerWatts: 0,
        strokeRate: 0
      }
    },
    0,
    0
  );

  assert.equal(res.sanitizedPower, 0);
});

