// Exemple d'endpoint `POST /live/participant-token` pour une App membre.
// Le backend de l'App membre signe un Jeton de Participant pour l'utilisateur
// déjà connecté ; le SDK l'obtient via son `tokenProvider`.
import { createServer } from "node:http";
import { SignJWT } from "jose";

// Identifiant de l'App membre et secret HS256 transmis en privé par echimine.
const APP_ID = process.env.LIVE_APP_ID ?? "demo-ios";
if (!process.env.LIVE_TOKEN_SECRET) {
  console.error("LIVE_TOKEN_SECRET manquant : fournissez le secret HS256 de votre App membre.");
  process.exit(1);
}
const SECRET = new TextEncoder().encode(process.env.LIVE_TOKEN_SECRET);

const PORT = Number(process.env.PORT ?? 4000);

/** À remplacer par l'authentification de votre app (session, JWT maison…). */
async function currentUser(_request) {
  return { id: "u_1042", username: "Léa", avatarUrl: "https://cdn.example.com/avatars/1042.jpg" };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Tronque à 30 caractères visibles : un emoji composé n'est jamais coupé. */
function truncateName(name) {
  return Array.from(graphemes.segment(name.trim()), (s) => s.segment).slice(0, 30).join("");
}

async function signParticipantToken(user) {
  const claims = { name: truncateName(user.username) };
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
