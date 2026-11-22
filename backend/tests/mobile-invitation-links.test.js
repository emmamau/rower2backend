const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withInvitationEmail,
  withRegattaMode,
  buildShareableRoomUrl,
} = require("../dist/utils/room-link.util");

test("withInvitationEmail: appends and encodes email query parameter correctly", () => {
  const base = "https://rowerrace.com/r/krm-wzx-qpl?mode=regatta";
  const withEmail = withInvitationEmail(base, "joueur.test+invit@example.com");
  assert.equal(
    withEmail,
    "https://rowerrace.com/r/krm-wzx-qpl?mode=regatta&email=joueur.test%2Binvit%40example.com"
  );

  // Does not duplicate if already present
  const duplicateCheck = withInvitationEmail(withEmail, "other@example.com");
  assert.equal(duplicateCheck, withEmail);

  // Preserves existing hash fragment
  const withHash = "https://rowerrace.com/r/abc-def-ghi?mode=regatta#section";
  const resHash = withInvitationEmail(withHash, "user@test.fr");
  assert.equal(resHash, "https://rowerrace.com/r/abc-def-ghi?mode=regatta&email=user%40test.fr#section");

  // Ignores empty or invalid email
  assert.equal(withInvitationEmail(base, ""), base);
  assert.equal(withInvitationEmail(base, "invalid-email-no-at"), base);
});

test("Canonical invitation URL pipeline: origin + code + mode=regatta + email", () => {
  const origin = "https://rowerrace.com";
  const code = "KRMWZXQPL";
  const baseJoinUrl = buildShareableRoomUrl(origin, code);
  assert.equal(baseJoinUrl, "https://rowerrace.com/r/krm-wzx-qpl");

  const regattaUrl = withRegattaMode(baseJoinUrl);
  assert.equal(regattaUrl, "https://rowerrace.com/r/krm-wzx-qpl?mode=regatta");

  const finalUrl = withInvitationEmail(regattaUrl, "invit.player@rower.fr");
  assert.equal(finalUrl, "https://rowerrace.com/r/krm-wzx-qpl?mode=regatta&email=invit.player%40rower.fr");
});
