"use strict";
/* 後台登入認證：Google Identity Services ID token 登入 + HMAC 簽章的 session cookie。
   不引入外部相依：前端取得 Google credential，server 用 Google 公開 JWKS 驗 RS256 簽章、
   比對管理員 allowlist 後簽發 HttpOnly cookie。
   環境變數：
   - GOOGLE_CLIENT_ID：OAuth client id（audience），登入必填。
   - ADMIN_EMAILS：逗號分隔 allowlist，預設 doggy.huang@gmail.com。
   - ADMIN_SESSION_SECRET：HMAC 金鑰；未設時每次重啟隨機產生（重啟即全員登出，對小後台可接受）。 */

var crypto = require("node:crypto");

var ADMIN_COOKIE = "admin_session";
var ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function adminEmailsFromEnv(env) {
  env = env || process.env;
  var raw = typeof env.ADMIN_EMAILS === "string" ? env.ADMIN_EMAILS.trim() : "";
  var list = raw.length > 0 ? raw.split(",") : ["doggy.huang@gmail.com"];
  var out = new Set();
  for (var i = 0; i < list.length; i++) {
    var email = list[i].trim().toLowerCase();
    if (email.length > 0) out.add(email);
  }
  return out;
}

function isAdminEmail(email, allowed) {
  return allowed.has(email.trim().toLowerCase());
}

// ------------------------------------------------------------- base64url

function b64urlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function b64urlEncode(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

// ------------------------------------------------------- Google ID token

var JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
var JWKS_TTL_MS = 60 * 60 * 1000;
var jwksCache = { keys: null, fetchedAt: 0 };

async function fetchGoogleJwks() {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  var res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("jwks fetch failed: HTTP " + res.status);
  var body = await res.json();
  var keys = new Map();
  var list = Array.isArray(body.keys) ? body.keys : [];
  for (var i = 0; i < list.length; i++) {
    var key = list[i];
    if (key && key.kid) keys.set(key.kid, key);
  }
  jwksCache.keys = keys;
  jwksCache.fetchedAt = Date.now();
  return keys;
}

// 驗證成功回傳 { email, name, sub }；任何一步不過回 null。
async function verifyGoogleIdToken(credential, clientId, deps) {
  deps = deps || {};
  var parts = credential.split(".");
  if (parts.length !== 3) return null;
  var header64 = parts[0], payload64 = parts[1], signature64 = parts[2];
  if (!header64 || !payload64 || !signature64) return null;
  var header, payload;
  try {
    header = JSON.parse(b64urlDecode(header64));
    payload = JSON.parse(b64urlDecode(payload64));
  } catch (e) {
    return null;
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  var jwk;
  try {
    var certs = await (deps.fetchCerts || fetchGoogleJwks)();
    jwk = certs.get(header.kid);
  } catch (e) {
    return null;
  }
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
  var key = crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  var signature = Buffer.from(signature64, "base64url");
  var valid = crypto.createVerify("RSA-SHA256").update(header64 + "." + payload64).end();
  if (!valid.verify(key, signature)) return null;

  var now = (deps.now || Date.now)();
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
  if (payload.aud !== clientId) return null;
  if (payload.email_verified !== true || typeof payload.email !== "string") return null;
  return {
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : "",
    sub: typeof payload.sub === "string" ? payload.sub : ""
  };
}

// --------------------------------------------------------- session token

// HMAC-SHA256 簽 base64url(JSON body)，格式 body.mac。
function signAdminSession(email, secret, ttlMs, now) {
  if (ttlMs === undefined) ttlMs = ADMIN_SESSION_TTL_MS;
  if (now === undefined) now = Date.now();
  var body = b64urlEncode(JSON.stringify({ email: email.toLowerCase(), exp: now + ttlMs }));
  var mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + mac;
}

function verifyAdminSession(token, secret, now) {
  if (now === undefined) now = Date.now();
  var dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  var body = token.slice(0, dot);
  var mac = token.slice(dot + 1);
  var expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  var a = Buffer.from(mac);
  var b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var payload = JSON.parse(b64urlDecode(body));
    if (!payload || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= now) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- cookies

function parseCookies(header) {
  var cookies = {};
  if (!header) return cookies;
  var parts = header.split(";");
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=");
    if (eq <= 0) continue;
    var name = parts[i].slice(0, eq).trim();
    var value = parts[i].slice(eq + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function adminCookieHeader(token, maxAgeSec) {
  if (maxAgeSec === undefined) maxAgeSec = ADMIN_SESSION_TTL_MS / 1000;
  return ADMIN_COOKIE + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSec;
}

function clearAdminCookieHeader() {
  return ADMIN_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function randomSecret() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  ADMIN_COOKIE: ADMIN_COOKIE,
  ADMIN_SESSION_TTL_MS: ADMIN_SESSION_TTL_MS,
  adminEmailsFromEnv: adminEmailsFromEnv,
  isAdminEmail: isAdminEmail,
  signAdminSession: signAdminSession,
  verifyAdminSession: verifyAdminSession,
  parseCookies: parseCookies,
  adminCookieHeader: adminCookieHeader,
  clearAdminCookieHeader: clearAdminCookieHeader,
  randomSecret: randomSecret,
  verifyGoogleIdToken: verifyGoogleIdToken
};