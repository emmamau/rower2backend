import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilTsPath = path.resolve(__dirname, '../src/app/utils/room-link.util.ts');

function loadTranspiledRoomLinkUtil() {
  const source = fs.readFileSync(utilTsPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const moduleObj = { exports: {} };
  const fn = new vm.Script(
    `(function(exports, module) { ${transpiled.outputText} })`,
    { filename: 'room-link.util.js' }
  ).runInThisContext();
  fn(moduleObj.exports, moduleObj);
  return moduleObj.exports;
}

const {
  normalizeSalonCode,
  parseRoomInviteInput,
  extractRoomFromLocation,
  buildShareableRoomUrl,
  buildRoomInviteMessage
} = loadTranspiledRoomLinkUtil();

test('normalizeSalonCode handles lowercase, uppercase, spaces, underscores, and rejects invalid lengths/digits', () => {
  assert.equal(normalizeSalonCode('krm-wzx-qpl'), 'krm-wzx-qpl');
  assert.equal(normalizeSalonCode('  KRM WZX QPL  '), 'krm-wzx-qpl');
  assert.equal(normalizeSalonCode('KRMWZXQPL'), 'krm-wzx-qpl');
  assert.equal(normalizeSalonCode('krm_wzx_qpl'), 'krm-wzx-qpl');
  assert.equal(normalizeSalonCode(''), null);
  assert.equal(normalizeSalonCode('abc-def'), null);
  assert.equal(normalizeSalonCode('abc-def-gh1'), null);
  assert.equal(normalizeSalonCode('abcdefghij'), null);
});

test('parseRoomInviteInput parses codes, 4-digit PINs, PRIV_ IDs, share URLs, query params, and multi-line invites', () => {
  // Empty / whitespace
  assert.deepEqual(parseRoomInviteInput(''), { valid: false, reason: 'empty' });
  assert.deepEqual(parseRoomInviteInput('   \n  '), { valid: false, reason: 'empty' });

  // Meet codes
  assert.deepEqual(parseRoomInviteInput('abc-def-ghi'), {
    valid: true,
    kind: 'code',
    value: 'abc-def-ghi'
  });
  assert.deepEqual(parseRoomInviteInput('ABCDEFGHI'), {
    valid: true,
    kind: 'code',
    value: 'abc-def-ghi'
  });

  // Alphanumeric PINs (including 5-character watch codes and spaced characters)
  assert.deepEqual(parseRoomInviteInput('4829'), {
    valid: true,
    kind: 'pin',
    value: '4829'
  });
  assert.deepEqual(parseRoomInviteInput('X7K2M'), {
    valid: true,
    kind: 'pin',
    value: 'X7K2M'
  });
  assert.deepEqual(parseRoomInviteInput(' x 7 k 2 m '), {
    valid: true,
    kind: 'pin',
    value: 'X7K2M'
  });

  // Direct PRIV_ race ID
  assert.deepEqual(parseRoomInviteInput('PRIV_abcdefghi'), {
    valid: true,
    kind: 'raceId',
    value: 'PRIV_abcdefghi'
  });

  // Full /r/:code and /salon/:code URLs
  assert.deepEqual(parseRoomInviteInput('https://rower-dashboard.onrender.com/r/krm-wzx-qpl'), {
    valid: true,
    kind: 'code',
    value: 'krm-wzx-qpl'
  });
  assert.deepEqual(parseRoomInviteInput('http://localhost:4200/salon/KRMWZXQPL?utm=chat#top'), {
    valid: true,
    kind: 'code',
    value: 'krm-wzx-qpl'
  });

  // Query parameter links (?room=, ?salon=, ?code=, ?pin=)
  assert.deepEqual(parseRoomInviteInput('https://example.com/?room=xyz-uvw-rst'), {
    valid: true,
    kind: 'code',
    value: 'xyz-uvw-rst'
  });
  assert.deepEqual(parseRoomInviteInput('/?pin=7391'), {
    valid: true,
    kind: 'pin',
    value: '7391'
  });

  // Multi-line full invitation text pasted directly into join input
  const inviteMsg = buildRoomInviteMessage({
    headerLabel: 'Invitation Salon Privé',
    title: 'Duel 2000m',
    targetDistance: 2000,
    urlLabel: 'URL',
    shareUrl: 'https://rower.app/r/mnq-rst-uvw',
    codeLabel: 'Code',
    code: 'mnq-rst-uvw',
    pinLabel: 'PIN Garmin',
    pinCode: '5512'
  });
  assert.deepEqual(parseRoomInviteInput(inviteMsg), {
    valid: true,
    kind: 'code',
    value: 'mnq-rst-uvw'
  });

  // Invalid inputs (too short, special chars)
  assert.deepEqual(parseRoomInviteInput('12'), { valid: false, reason: 'invalid_format' });
  assert.deepEqual(parseRoomInviteInput('X7#2M'), { valid: false, reason: 'invalid_format' });
  assert.deepEqual(parseRoomInviteInput('https://rower.app/r/bad!token'), {
    valid: false,
    reason: 'invalid_format'
  });
});

test('extractRoomFromLocation handles root public route, /r/:code, /salon/:code, query params, and malformed paths', () => {
  assert.equal(extractRoomFromLocation('/', ''), null);
  assert.equal(extractRoomFromLocation('/index.html', '?lang=fr'), null);

  assert.deepEqual(extractRoomFromLocation('/r/krm-wzx-qpl', ''), {
    valid: true,
    kind: 'code',
    value: 'krm-wzx-qpl'
  });
  assert.deepEqual(extractRoomFromLocation('/salon/4829', ''), {
    valid: true,
    kind: 'pin',
    value: '4829'
  });
  assert.deepEqual(extractRoomFromLocation('/', '?salon=abc-def-ghi'), {
    valid: true,
    kind: 'code',
    value: 'abc-def-ghi'
  });

  // Empty or invalid room path/query surfaces explicit validation state
  assert.deepEqual(extractRoomFromLocation('/r/', ''), { valid: false, reason: 'empty' });
  assert.deepEqual(extractRoomFromLocation('/r/invalid99', ''), {
    valid: false,
    reason: 'invalid_format'
  });
  assert.deepEqual(extractRoomFromLocation('/', '?room='), { valid: false, reason: 'empty' });
});

test('buildShareableRoomUrl normalizes trailing slashes and salon codes', () => {
  assert.equal(
    buildShareableRoomUrl('https://rower.example.com/', 'KRM WZX QPL'),
    'https://rower.example.com/r/krm-wzx-qpl'
  );
  assert.equal(buildShareableRoomUrl('', 'abc-def-ghi'), '/r/abc-def-ghi');
});

