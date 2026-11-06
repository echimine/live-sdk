// Exemple d'endpoint `POST /live/participant-token` pour une App membre.
// Le backend de l'App membre signe un Jeton de Participant pour l'utilisateur
// déjà connecté ; le SDK l'obtient via son `tokenProvider`.
import { createServer } from "node:http";
import { SignJWT } from "jose";

// Identifiant de l'App membre et secret HS256 transmis en privé par echimine.
const APP_ID = process.env.LIVE_APP_ID ?? "demo-ios";
const SECRET = new TextEncoder().encode(
  process.env.LIVE_TOKEN_SECRET ?? "secret-factice-demo-ios-ne-jamais-utiliser-en-prod",
);

const PORT = Number(process.env.PORT ?? 4000);

/** À remplacer par l'authentification de votre app (session, JWT maison…). */
async function currentUser(_request) {
  return { id: "u_1042", username: "Léa", avatarUrl: "https://cdn.example.com/avatars/1042.jpg" };
}

async function signParticipantToken(user) {
  const claims = { name: user.username.slice(0, 30) };
  // `picture` doit être en https, sinon le serveur commun l'ignore.
  if (user.avatarUrl?.startsWith("https://")) claims.picture = user.avatarUrl;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(APP_ID)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(SECRET);
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/live/participant-token") {
    response.writeHead(404).end();
    return;
  }
  const user = await currentUser(request);
  if (!user) {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ token: await signParticipantToken(user) }));
}).listen(PORT, () => {
  console.log(`POST http://localhost:${PORT}/live/participant-token`);
});
