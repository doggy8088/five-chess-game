"use strict";
/* 後台認證（auth.js）測試：管理員 allowlist、session token 簽驗、cookie header、
   Google ID token 驗證（本機 RSA keypair 自簽，經 fetchCerts 注入，不連外）。 */

var test = require("node:test");
var assert = require("node:assert");
var crypto = require("node:crypto");
var auth = require("../auth.js");

// ------------------------------------------------------------ allowlist

test("allowlist：預設只允許 doggy.huang@gmail.com（不分大小寫）", function () {
  var emails = auth.adminEmailsFromEnv({});
  assert.ok(emails.has("doggy.huang@gmail.com"));
  assert.equal(auth.isAdminEmail("Doggy.Huang@Gmail.com", emails), true);
  assert.equal(auth.isAdminEmail("someone@else.com", emails), false);
});

test("allowlist：解析 ADMIN_EMAILS 逗號清單、去空白並不分大小寫去重", function () {
  var emails = auth.adminEmailsFromEnv({ ADMIN_EMAILS: "a@x.com, B@Y.com ,b@y.com" });
  assert.ok(emails.has("a@x.com"));
  assert.ok(emails.has("b@y.com"));
  assert.equal(emails.size, 2);
});

// -------------------------------------------------------- session token

test("session：簽章 roundtrip、防竄改、過期、金鑰不符", function () {
  var token = auth.signAdminSession("doggy.huang@gmail.com", "secret", 60000, 1000000);
  assert.equal(auth.verifyAdminSession(token, "secret", 1000500).email, "doggy.huang@gmail.com");
  assert.equal(auth.verifyAdminSession(token, "secret", 1061000), null, "過期應拒絕");
  assert.equal(auth.verifyAdminSession(token, "other-secret", 1000000), null, "金鑰不符應拒絕");
  var split = token.split(".");
  var tampered = split[0].slice(0, -2) + "xx." + split[1];
  assert.equal(auth.verifyAdminSession(tampered, "secret", 1000000), null, "改 body 應拒絕");
  assert.equal(auth.verifyAdminSession("garbage", "secret"), null);
});

test("session：TTL 常數 12h、cookie header 預設 Max-Age=43200", function () {
  assert.equal(auth.ADMIN_SESSION_TTL_MS, 12 * 60 * 60 * 1000);
  assert.equal(auth.adminCookieHeader("t", 120),
    "admin_session=t; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120");
  assert.equal(auth.adminCookieHeader("t"),
    "admin_session=t; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200");
  assert.ok(auth.clearAdminCookieHeader().includes("Max-Age=0"));
});

test("cookie：解析 Cookie header（%編碼、無值回空物件）", function () {
  var cookies = auth.parseCookies("a=1; admin_session=%2Fabc; c=3");
  assert.equal(cookies["admin_session"], "/abc");
  assert.deepEqual(auth.parseCookies(undefined), {});
  assert.deepEqual(auth.parseCookies(""), {});
});

test("randomSecret：32 bytes hex（64 碼）", function () {
  assert.match(auth.randomSecret(), /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------- Google ID token

// 本機 RSA keypair：publicKey 匯出 JWK 當 Google JWKS、privateKey 自簽 token
var keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
var jwk = keyPair.publicKey.export({ format: "jwk" });

function b64url(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

async function jwkMap() {
  return new Map([["test-key", { kty: "RSA", n: jwk.n, e: jwk.e }]]);
}

function signCredential(payload, kid) {
  if (kid === undefined) kid = "test-key";
  var header = b64url(JSON.stringify({ alg: "RS256", kid: kid }));
  var body = b64url(JSON.stringify(payload));
  var signature = crypto.createSign("RSA-SHA256").update(header + "." + body).sign(keyPair.privateKey);
  return header + "." + body + "." + signature.toString("base64url");
}

var NOW = 1700000000000;
var NOW_SEC = NOW / 1000;
var BASE = { iss: "accounts.google.com", email: "doggy.huang@gmail.com", email_verified: true, sub: "12345" };

function verifyOpts() {
  return { fetchCerts: jwkMap, now: function () { return NOW; } };
}

test("google token：有效 token（aud 相符、email 已驗證）", async function () {
  var credential = signCredential(Object.assign({}, BASE, { aud: "client-123", exp: NOW_SEC + 600, name: "保哥" }));
  var identity = await auth.verifyGoogleIdToken(credential, "client-123", verifyOpts());
  assert.ok(identity);
  assert.equal(identity.email, "doggy.huang@gmail.com");
  assert.equal(identity.name, "保哥");
  assert.equal(identity.sub, "12345");
});

test("google token：拒絕 audience 不符", async function () {
  var credential = signCredential(Object.assign({}, BASE, { aud: "other-client", exp: NOW_SEC + 600 }));
  assert.equal(await auth.verifyGoogleIdToken(credential, "client-123", verifyOpts()), null);
});

test("google token：拒絕過期 token", async function () {
  var credential = signCredential(Object.assign({}, BASE, { aud: "client-123", exp: NOW_SEC - 10 }));
  assert.equal(await auth.verifyGoogleIdToken(credential, "client-123", verifyOpts()), null);
});

test("google token：拒絕 email 未驗證", async function () {
  var credential = signCredential(Object.assign({}, BASE, { aud: "client-123", exp: NOW_SEC + 600, email_verified: false }));
  assert.equal(await auth.verifyGoogleIdToken(credential, "client-123", verifyOpts()), null);
});

test("google token：拒絕未知 kid 與他人私鑰簽章", async function () {
  var unknownKid = signCredential(Object.assign({}, BASE, { aud: "client-123", exp: NOW_SEC + 600 }), "unknown-kid");
  assert.equal(await auth.verifyGoogleIdToken(unknownKid, "client-123", verifyOpts()), null);

  var foreign = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  var header = b64url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  var body = b64url(JSON.stringify(Object.assign({}, BASE, { aud: "client-123", exp: NOW_SEC + 600 })));
  var signature = crypto.createSign("RSA-SHA256").update(header + "." + body).sign(foreign.privateKey);
  var forged = header + "." + body + "." + signature.toString("base64url");
  assert.equal(await auth.verifyGoogleIdToken(forged, "client-123", verifyOpts()), null);
});

test("google token：拒絕 malformed 輸入", async function () {
  assert.equal(await auth.verifyGoogleIdToken("not-a-jwt", "client-123", verifyOpts()), null);
});