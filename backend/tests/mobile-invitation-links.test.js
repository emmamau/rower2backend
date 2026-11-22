const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withInvitationEmail,
  withRegattaMode,
  buildShareableRoomUrl,
  detectInAppBrowser,
  buildAndroidIntentUrl,
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

test("detectInAppBrowser: detects Android WebViews and iOS mail/social in-app browsers", () => {
  // Android Gmail / WebView
  const androidGmailUA = "Mozilla/5.0 (Linux; U; Android 14; fr-fr; Pixel 7 Build/UQ1A.240205.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 (GSA/15.3.33.28.arm64)";
  const androidRes = detectInAppBrowser(androidGmailUA);
  assert.equal(androidRes.isInApp, true);
  assert.equal(androidRes.isAndroidInApp, true);
  assert.equal(androidRes.isIosInApp, false);

  // iOS Gmail / In-App browser
  const iosGmailUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/300.0.593798997";
  const iosRes = detectInAppBrowser(iosGmailUA);
  assert.equal(iosRes.isInApp, true);
  assert.equal(iosRes.isIosInApp, true);
  assert.equal(iosRes.isAndroidInApp, false);

  // Standard Safari on iOS (not in-app)
  const standardIosSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
  const safariRes = detectInAppBrowser(standardIosSafari);
  assert.equal(safariRes.isInApp, false);

  // Standard Chrome on Android (not in-app)
  const standardAndroidChrome = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
  const chromeRes = detectInAppBrowser(standardAndroidChrome);
  assert.equal(chromeRes.isInApp, false);
});

test("buildAndroidIntentUrl: generates valid intent URI for external browser launch", () => {
  const url = "https://rowerrace.com/r/krm-wzx-qpl?mode=regatta&email=test%40rower.fr";
  const intent = buildAndroidIntentUrl(url);
  assert.equal(
    intent,
    "intent://rowerrace.com/r/krm-wzx-qpl?mode=regatta&email=test%40rower.fr#Intent;scheme=https;action=android.intent.action.VIEW;end"
  );
  assert.equal(buildAndroidIntentUrl(""), "");
});
