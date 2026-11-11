import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import User from "../server/models/User.js";
import Snippet from "../server/models/Snippet.js";
import { createApp } from "../server/app.js";

test("API enforces registration, valid credentials, sessions, and snippet ownership", async (t) => {
  const originalEnv = {
    jwt: process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
    clientOrigin: process.env.CLIENT_ORIGIN,
  };
  process.env.JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";
  process.env.NODE_ENV = "test";
  process.env.CLIENT_ORIGIN = "https://harshkoli9.github.io";

  const originals = {
    exists: User.exists,
    create: User.create,
    findOne: User.findOne,
    userFindOneAndUpdate: User.findOneAndUpdate,
    findById: User.findById,
    find: Snippet.find,
    countDocuments: Snippet.countDocuments,
    snippetCreate: Snippet.create,
    findOneAndUpdate: Snippet.findOneAndUpdate,
    findOneAndDelete: Snippet.findOneAndDelete,
    deleteMany: Snippet.deleteMany,
  };

  const account = {
    id: "111111111111111111111111",
    name: "Ada",
    email: "ada@example.com",
    passwordHash: "",
  };
  let accountExists = false;
  let createdSnippet;
  let deleteFilter;
  let snippets = [];
  let resetConsumed = false;
  let resetFilter;
  let resetUpdate;

  User.exists = async () => accountExists;
  User.create = async ({ name, email, passwordHash }) => {
    Object.assign(account, { name, email, passwordHash });
    accountExists = true;
    return account;
  };
  User.findOne = () => ({ select: async () => account });
  User.findOneAndUpdate = async (filter, update) => {
    resetFilter = filter;
    resetUpdate = update;
    if (resetConsumed) return null;
    resetConsumed = true;
    account.authVersion = (account.authVersion || 0) + 1;
    return account;
  };
  User.findById = () => ({ select: async () => ({ id: account.id, name: account.name, email: account.email }) });
  Snippet.find = () => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => snippets,
  });
  Snippet.countDocuments = async () => snippets.length;
  Snippet.create = async (input) => {
    createdSnippet = { _id: "222222222222222222222222", ...input, createdAt: new Date() };
    snippets = [createdSnippet];
    return createdSnippet;
  };
  Snippet.findOneAndUpdate = async (filter, input) => {
    deleteFilter = filter;
    return filter.owner === account.id ? { _id: filter._id, ...input, owner: account.id, createdAt: new Date() } : null;
  };
  Snippet.findOneAndDelete = async (filter) => {
    deleteFilter = filter;
    return filter.owner === account.id && filter._id === createdSnippet?._id ? createdSnippet : null;
  };
  Snippet.deleteMany = async (filter) => {
    deleteFilter = filter;
    const deletedCount = snippets.filter((snippet) => snippet.owner === filter.owner).length;
    snippets = snippets.filter((snippet) => snippet.owner !== filter.owner);
    return { deletedCount };
  };

  const server = createApp({ serveClient: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Object.assign(User, { exists: originals.exists, create: originals.create, findOne: originals.findOne, findOneAndUpdate: originals.userFindOneAndUpdate, findById: originals.findById });
    Object.assign(Snippet, {
      find: originals.find,
      countDocuments: originals.countDocuments,
      create: originals.snippetCreate,
      findOneAndUpdate: originals.findOneAndUpdate,
      findOneAndDelete: originals.findOneAndDelete,
      deleteMany: originals.deleteMany,
    });
    if (originalEnv.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalEnv.jwt;
    if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv.nodeEnv;
    if (originalEnv.clientOrigin === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = originalEnv.clientOrigin;
  });

  async function request(route, { method = "GET", body, token } = {}) {
    return fetch(`${origin}${route}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  const unauthorizedList = await request("/api/snippets");
  assert.equal(unauthorizedList.status, 401, "snippet access requires a signed-in account");

  const validPreflight = await fetch(`${origin}/api/auth/login`, {
    method: "OPTIONS",
    headers: { Origin: "https://harshkoli9.github.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
  });
  assert.equal(validPreflight.headers.get("access-control-allow-origin"), "https://harshkoli9.github.io");
  assert.match(validPreflight.headers.get("access-control-allow-headers"), /authorization/i);

  const invalidPreflight = await fetch(`${origin}/api/auth/login`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(invalidPreflight.headers.get("access-control-allow-origin"), null, "unapproved websites cannot read API responses");

  const invalidRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Ada", email: "ada@example.com", password: "short" },
  });
  assert.equal(invalidRegistration.status, 400, "short passwords are rejected");

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: " Ada ", email: "ADA@example.com", password: "correct horse battery staple" },
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  assert.equal(registered.user.email, "ada@example.com", "email is normalized");
  assert.equal(registered.user.name, "Ada", "name is trimmed");
  assert.equal("passwordHash" in registered.user, false, "password hash is never returned");
  assert.equal(typeof registered.token, "string", "registration creates a signed-in session token");
  assert.notEqual(account.passwordHash, "correct horse battery staple");
  assert.equal(await bcrypt.compare("correct horse battery staple", account.passwordHash), true);
  assert.equal(registration.headers.get("set-cookie"), null, "cross-origin GitHub Pages does not rely on blocked third-party cookies");
  const token = registered.token;

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Ada", email: "ada@example.com", password: "correct horse battery staple" },
  });
  assert.equal(duplicate.status, 409, "existing accounts get a login path rather than duplicate registration");

  const badLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "ada@example.com", password: "wrong password" },
  });
  assert.equal(badLogin.status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "ada@example.com", password: "correct horse battery staple" },
  });
  assert.equal(login.status, 200);
  const loginData = await login.json();
  assert.equal(typeof loginData.token, "string");

  const currentUser = await request("/api/auth/me", { token });
  assert.equal(currentUser.status, 200);
  assert.equal((await currentUser.json()).user.id, account.id);

  const noSessionCreate = await request("/api/snippets", {
    method: "POST",
    body: { title: "Private", code: "const x = 1;", language: "javascript" },
  });
  assert.equal(noSessionCreate.status, 401, "snippet creation requires a session");

  const saved = await request("/api/snippets", {
    method: "POST",
    token,
    body: { title: "Example", code: "const x = 1;", language: "javascript" },
  });
  assert.equal(saved.status, 201);
  assert.equal(createdSnippet.owner, account.id, "ownership comes from the verified session");
  assert.equal((await saved.json()).snippet.author, "Ada");

  const list = await request("/api/snippets?page=1&limit=30", { token });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).snippets.length, 1);

  const foreignDelete = await request("/api/snippets/333333333333333333333333", { method: "DELETE", token });
  assert.equal(foreignDelete.status, 404);
  assert.equal(deleteFilter.owner, account.id, "delete query is constrained to the signed-in owner");
  assert.equal(deleteFilter._id, "333333333333333333333333");

  const update = await request("/api/snippets/222222222222222222222222", {
    method: "PUT",
    token,
    body: { title: "Updated", code: "const x = 2;", language: "javascript" },
  });
  assert.equal(update.status, 200);
  assert.equal(deleteFilter.owner, account.id, "update query is constrained to the signed-in owner");

  const deleteMine = await request("/api/snippets/mine/all", { method: "DELETE", token });
  assert.equal(deleteMine.status, 200);
  assert.equal(deleteFilter.owner, account.id, "bulk delete is constrained to the signed-in owner");

  const badJson = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  assert.equal(badJson.status, 400, "malformed JSON receives a client error");

  const originalEmailConfig = { resend: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, frontend: process.env.FRONTEND_URL };
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.FRONTEND_URL;
  const emailUnavailable = await request("/api/auth/forgot-password", { method: "POST", body: { email: "ada@example.com" } });
  assert.equal(emailUnavailable.status, 503, "recovery does not claim delivery when email is not configured");
  assert.match((await emailUnavailable.json()).message, /not configured/i);
  for (const [key, value] of [["RESEND_API_KEY", originalEmailConfig.resend], ["EMAIL_FROM", originalEmailConfig.from], ["FRONTEND_URL", originalEmailConfig.frontend]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const weakReset = await request("/api/auth/reset-password", { method: "POST", body: { token: "a".repeat(43), password: "short" } });
  assert.equal(weakReset.status, 400, "reset passwords enforce the minimum length");
  const newPassword = "a newly chosen secure password";
  const reset = await request("/api/auth/reset-password", { method: "POST", body: { token: "example-single-use-token-value-1234567890", password: newPassword } });
  assert.equal(reset.status, 200);
  assert.equal(resetFilter.resetTokenExpiresAt.$gt instanceof Date, true, "expired links are excluded by the atomic consume query");
  assert.equal(typeof resetFilter.resetTokenHash, "string", "the lookup uses a token hash");
  assert.equal(resetUpdate.$inc.authVersion, 1, "password reset invalidates existing sessions");
  assert.equal(await bcrypt.compare(newPassword, resetUpdate.$set.passwordHash), true, "the replacement password is hashed");
  const reused = await request("/api/auth/reset-password", { method: "POST", body: { token: "example-single-use-token-value-1234567890", password: newPassword } });
  assert.equal(reused.status, 400, "a consumed reset link cannot be reused");
});

test("local server health fails closed but stays available without MongoDB", async (t) => {
  const server = createApp({ serveClient: false, databaseReady: () => false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), { status: "database_unavailable", database: false });

  const registration = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "correct horse battery staple" }),
  });
  assert.equal(registration.status, 503);
  assert.match((await registration.json()).message, /MONGODB_URI/i);
});
