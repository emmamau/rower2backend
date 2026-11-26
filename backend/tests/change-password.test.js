const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const http = require("http");

describe("Changement de mot de passe connecté (PUT /api/user/password)", () => {
  let server;
  let baseUrl;
  let testUserToken;
  let testUserLogin;
  const initialPassword = "Password123!";
  const updatedPassword = "NewSecret456!";

  before(async () => {
    process.env.NODE_ENV = "test";
    const appModule = require("../dist/index");
    const app = appModule.default || appModule.app || appModule;
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Créer un utilisateur de test
    testUserLogin = "pwd_user_" + Date.now().toString().slice(-6);
    const regRes = await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nom: "Tester",
        prenom: "Password",
        anneeNaissance: 1995,
        sexe: "M",
        pays: "France",
        login: testUserLogin,
        email: `${testUserLogin}@test.com`,
        password: initialPassword,
      }),
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201, "L'utilisateur doit être créé");

    // Connexion pour récupérer le jeton JWT
    const loginRes = await fetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testUserLogin,
        password: initialPassword,
      }),
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, "Connexion réussie");
    assert.ok(loginData.token, "Le jeton JWT doit être présent");
    testUserToken = loginData.token;
  });

  after((done) => {
    if (server) server.close(done);
    else done();
  });

  it("doit refuser la requête si aucun jeton d'authentification n'est fourni (401)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: updatedPassword,
      }),
    });
    assert.strictEqual(res.status, 401);
  });

  it("doit refuser si des champs sont manquants (400)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUserToken}`,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
  });

  it("doit refuser si le mot de passe actuel est erroné (401)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUserToken}`,
      },
      body: JSON.stringify({
        currentPassword: "WrongPassword999!",
        newPassword: updatedPassword,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("incorrect"));
  });

  it("doit refuser si le nouveau mot de passe est trop faible (400)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUserToken}`,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: "weak",
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
  });

  it("doit refuser si le nouveau mot de passe est identique au mot de passe actuel (400)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUserToken}`,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: initialPassword,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("différent"));
  });

  it("doit mettre à jour le mot de passe avec succès avec un mot de passe valide (200)", async () => {
    const res = await fetch(`${baseUrl}/api/user/password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUserToken}`,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: updatedPassword,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.message.includes("succès"));

    // Vérifier que l'ancien mot de passe ne permet plus de se connecter
    const oldLoginRes = await fetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testUserLogin,
        password: initialPassword,
      }),
    });
    assert.strictEqual(oldLoginRes.status, 401);

    // Vérifier que le nouveau mot de passe permet de se connecter
    const newLoginRes = await fetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testUserLogin,
        password: updatedPassword,
      }),
    });
    const newLoginData = await newLoginRes.json();
    assert.strictEqual(newLoginRes.status, 200);
    assert.ok(newLoginData.token);
  });
});
