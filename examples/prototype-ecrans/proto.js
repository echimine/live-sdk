// PROTOTYPE JETABLE — ticket « À quoi ressemblent les écrans prêts à l'emploi ? » (#10).
// Tout est simulé en mémoire : aucun serveur, aucun LiveKit. À ne pas fusionner dans main.

// Jetons de thème que chaque App membre pourrait passer au SDK (couleurs = palettes indicatives).
const APPS = {
  tiktok: { name: 'TikTok_Clone', accent: '#fe2c55', accentFg: '#fff', bg: '#000', fg: '#fff', surface: '#1c1c1e', font: 'system-ui', radius: 8, label: 'LIVE' },
  twitch: { name: 'twitch', accent: '#9146ff', accentFg: '#fff', bg: '#0e0e10', fg: '#efeff1', surface: '#1f1f23', font: 'Inter, system-ui', radius: 6, label: 'Live commun' },
  insta: { name: 'clone_instagram', accent: '#d62976', accentFg: '#fff', bg: '#000', fg: '#fff', surface: '#262626', font: 'system-ui', radius: 14, label: 'EN DIRECT' },
  snap: { name: 'snapcore', accent: '#fffc00', accentFg: '#000', bg: '#111', fg: '#fff', surface: '#222', font: '"Avenir Next", system-ui', radius: 20, label: 'Live' },
  strava: { name: 'clone-strava', accent: '#fc4c02', accentFg: '#fff', bg: '#fff', fg: '#242428', surface: '#f2f2f4', font: '"Helvetica Neue", system-ui', radius: 4, label: 'Live' },
};
const APP_COLORS = { tiktok: '#fe2c55', twitch: '#9146ff', insta: '#d62976', snap: '#b8a800', strava: '#fc4c02' };
const REACTIONS = ['❤️', '🔥', '😂', '👏', '😮', '🎉']; // jeu fixe servi par GET /v1/config
const PEOPLE = [['Léa', 'twitch'], ['Nora', 'insta'], ['Sami', 'strava'], ['Yanis', 'snap'], ['Inès', 'tiktok'], ['Tom', 'twitch'], ['Maëlle', 'insta'], ['Hugo', 'strava']];
const LINES = ['Salut tout le monde 👋', 'Il coûte combien ?', 'Trop bien ce live', 'On voit bien depuis Strava 🏃', 'Je viens de snapcore !', 'Tu peux montrer de plus près ?', 'Il existe en noir ?', 'Énorme 🔥', 'spam spam spam'];
const LIVES = [
  { id: 'l1', title: 'Unboxing gourde isotherme', host: ['Eliott', 'twitch'], aud: 34, emoji: '🧴' },
  { id: 'l2', title: 'Course du soir au parc', host: ['Sami', 'strava'], aud: 12, emoji: '🏃' },
  { id: 'l3', title: 'Q&R design', host: ['Nora', 'insta'], aud: 21, emoji: '🎨' },
  { id: 'l4', title: 'Cuisine rapide', host: ['Inès', 'tiktok'], aud: 8, emoji: '🍜' },
];

const qs = new URLSearchParams(location.search);
const S = {
  variant: qs.get('variant') || 'A', screen: qs.get('screen') || 'regarder', app: qs.get('app') || 'twitch', role: qs.get('role') || 'spectateur',
  tab: 'chat', sheet: null, sheetArg: null, feedIdx: 0, filter: null,
  theme: null, // surcharges éventuelles
  chat: [], seq: 0, reactionsTotal: 0,
  audience: { tiktok: 9, twitch: 11, insta: 6, snap: 4, strava: 3 },
  product: { name: 'Gourde isotherme 750 ml', price: '24,90 €', emoji: '🧴' },
  productHidden: false, purchases: 0,
  requests: [['Yanis', 'snap']], cohosts: [['Nora', 'insta']], myRequest: null,
  banned: [], shadow: [], log: [],
};
const me = () => ['Moi', S.app];
const T = () => ({ ...APPS[S.app], ...(S.theme || {}) });
const VARIANTS = { A: 'Plein écran superposé (captures)', B: 'Vidéo + panneau à onglets', C: 'Épuré, tout en feuilles' };
const isAnim = () => S.role === 'hote';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const log = (e) => { S.log.unshift(e); S.log.length = Math.min(S.log.length, 12); };

// ---------- briques communes ----------
const avatar = ([n, a]) => `<span class="avatar" style="background:${APP_COLORS[a]}">${esc(n[0])}</span>`;
const appChip = (a) => `<span class="chip" style="background:${APP_COLORS[a]}">${APPS[a].name}</span>`;
const audTotal = () => Object.values(S.audience).reduce((x, y) => x + y, 0);
const host = () => (S.role === 'hote' ? me() : ['Eliott', 'twitch']);

function msgHTML(m) {
  const viewerIsAuthor = m.who && m.who[0] === 'Moi';
  if (m.shadow && !isAnim() && !viewerIsAuthor) return ''; // Shadowban : invisible pour les autres
  const cls = ['msg', m.kind, m.shadow && isAnim() ? 'shadow' : '', isAnim() && m.kind === 'msg' ? 'mod' : ''].join(' ');
  if (m.kind === 'systeme') return `<div class="${cls}">👋 ${esc(m.text)}</div>`;
  if (m.kind === 'achat') return `<div class="${cls}">🛍 <span><b>${esc(m.who[0])}</b>${appChip(m.who[1])} a acheté ${esc(m.text)}</span></div>`;
  const isHost = m.who[0] === host()[0];
  return `<div class="${cls}" data-act="mod" data-id="${m.id}">${avatar(m.who)}<span><span class="who"><b>${esc(m.who[0])}</b>${appChip(m.who[1])}${isHost ? '<span class="hostbadge">Hôte</span>' : ''}</span> ${esc(m.text)}</span></div>`;
}
const chatHTML = () => S.chat.slice(-30).map(msgHTML).join('');

function videoHTML() {
  const tiles = [host(), ...S.cohosts];
  return `<div class="video n${tiles.length}">${tiles.map((p, i) => `<div class="tile">${i === 0 ? '🎥' : '🙂'}<span class="tag">${esc(p[0])} · ${APPS[p[1]].name}</span>${i > 0 && isAnim() ? `<button class="ghost x" data-act="retirer" data-i="${i - 1}">Retirer</button>` : ''}</div>`).join('')}</div>`;
}
function audienceDetail() {
  const t = audTotal();
  return `<div class="list">${Object.entries(S.audience).map(([a, n]) => `<div class="row">${appChip(a)}<div style="flex:1;height:6px;background:rgba(127,127,127,.25);border-radius:3px"><div style="width:${(n / t) * 100}%;height:100%;background:${APP_COLORS[a]};border-radius:3px"></div></div><b>${n}</b></div>`).join('')}</div><p class="muted" style="margin-top:8px">${t} Spectateurs · Animateurs exclus · mis à jour toutes les 2 s</p>`;
}
function productBlock() {
  if (!S.product) return `<div class="muted">Aucun Produit épinglé</div>`;
  return `<div class="product"><div class="img">${S.product.emoji}</div><div style="flex:1"><div>${esc(S.product.name)}</div><div class="price">${S.product.price}</div></div>${isAnim() ? '' : '<button class="sdk" data-act="acheter">Acheter</button>'}</div>`;
}
function montee() {
  if (isAnim()) return '';
  if (S.myRequest === 'en_attente') return `<button class="ghost" data-act="annuler-montee">✋ En attente…</button>`;
  return `<button class="ghost" data-act="montee">✋ Monter</button>`;
}

// ---------- feuilles ----------
const SHEETS = {
  achat: () => `<div class="sheet detail shop"><div class="grab"></div><div class="hero">${S.product.emoji}</div>
    <div class="bigprice">${S.product.price}</div><div style="margin:6px 0 4px">${esc(S.product.name)}</div>
    <p class="muted">Achat simulé : aucun paiement. Tous les Participants verront une Annonce d'achat dans le chat.</p>
    <button class="sdk" data-act="confirmer-achat">Confirmer l'achat</button></div>`,
  boutique: () => `<div class="sheet shop"><div class="grab"></div><h3>Produit épinglé</h3>
    ${S.product ? `<div class="prow"><div class="pimg">${S.product.emoji}<span class="tag" style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:11px;text-align:center">📌 Épinglé</span></div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between"><div>${esc(S.product.name)}</div><div class="row" style="justify-content:space-between"><b style="font-size:20px">${S.product.price}</b>${isAnim() ? '' : '<button class="sdk" data-act="acheter">Acheter</button>'}</div></div></div>` : '<p class="muted">Rien d\'épinglé pour l\'instant.</p>'}
    <p class="muted">Un seul produit à la fois en v1 : pas de vitrine, pas de panier, pas de quantité.</p>
    ${isAnim() ? '<button class="ghost" data-act="sheet" data-s="epingler" style="margin-top:10px">Changer le Produit épinglé</button>' : ''}</div>`,
  reactions: () => `<div class="sheet"><div class="grab"></div><h3>Réactions</h3><div class="row" style="justify-content:space-around;font-size:32px">${REACTIONS.map((r) => `<button class="ghost" style="font-size:30px" data-act="react" data-r="${r}">${r}</button>`).join('')}</div><p class="muted" style="margin-top:8px">Total du Live : ${S.reactionsTotal}</p></div>`,
  audience: () => `<div class="sheet"><div class="grab"></div><h3>Audience</h3>${audienceDetail()}</div>`,
  chat: () => `<div class="sheet" style="height:60%;display:flex;flex-direction:column"><div class="grab"></div><h3>Chat</h3><div data-slot="chat" style="flex:1;overflow:auto">${chatHTML()}</div><div class="row" style="margin-top:8px"><input class="sdk" data-input="chat" placeholder="Écrire…"><button class="sdk" data-act="send">➤</button></div></div>`,
  mod: () => {
    const m = S.chat.find((x) => x.id === S.sheetArg); if (!m) return '';
    const sb = S.shadow.includes(m.who.join('@'));
    return `<div class="sheet"><div class="grab"></div><h3>${avatar(m.who)} ${esc(m.who[0])} ${appChip(m.who[1])}</h3><p style="margin-bottom:10px">« ${esc(m.text)} »</p><div class="list">
      <div data-act="supprimer" style="cursor:pointer">🗑 Supprimer ce message</div>
      <div data-act="shadowban" style="cursor:pointer">👻 ${sb ? 'Lever le Shadowban' : 'Shadowban (ses messages ne seront visibles que par lui)'}</div>
      <div data-act="bannir" style="cursor:pointer;color:#e5484d">⛔ Bannir définitivement de ce Live</div></div></div>`;
  },
  gestion: () => `<div class="sheet"><div class="grab"></div><h3>Gestion du Live</h3>${gestionHTML()}</div>`,
  epingler: () => `<div class="sheet form"><div class="grab"></div><h3>Épingler un produit</h3>
    <label>Nom</label><input class="sdk" data-input="pname" value="Casquette running">
    <label>Prix</label><input class="sdk" data-input="pprice" value="19,00 €">
    <label>Image</label><div class="row"><button class="ghost">📷 Choisir une photo</button><span class="muted">upload HTTP</span></div>
    <p class="muted" style="margin-top:10px">Saisie manuelle. Si l'App membre branche une « source de produits », une liste de son catalogue apparaîtrait ici.</p>
    <div class="row" style="margin-top:14px"><button class="sdk" data-act="epingler">Épingler</button>${S.product ? '<button class="ghost" data-act="desepingler">Retirer l\'épingle</button>' : ''}</div></div>`,
  fin: () => `<div class="sheet"><div class="grab"></div><h3>Terminer le Live ?</h3><p class="muted">Tous les Participants seront déconnectés. Pas de replay.</p><div class="row" style="margin-top:12px"><button class="sdk" data-act="terminer">Terminer</button><button class="ghost" data-act="close">Annuler</button></div></div>`,
  termine: () => `<div class="sheet"><div class="grab"></div><h3>Le Live est terminé</h3><p class="muted">${S.purchases} Achats · ${S.reactionsTotal} Réactions · pic d'Audience ${audTotal()}</p><button class="sdk" style="margin-top:12px" data-act="goto" data-s="liste">Voir les autres Lives</button></div>`,
};
function gestionHTML() {
  return `<div class="list">
    <div><b>Demandes de montée</b> (${S.requests.length})${S.requests.map((p, i) => `<div class="row" style="margin-top:6px">${avatar(p)}<span style="flex:1">${esc(p[0])} ${appChip(p[1])}</span><button class="sdk" data-act="accepter" data-i="${i}">Accepter</button><button class="ghost" data-act="refuser" data-i="${i}">Refuser</button></div>`).join('') || '<div class="muted">Aucune</div>'}</div>
    <div><b>Co-hôtes</b> (${S.cohosts.length}/4)${S.cohosts.map((p, i) => `<div class="row" style="margin-top:6px">${avatar(p)}<span style="flex:1">${esc(p[0])} ${appChip(p[1])}</span><button class="ghost" data-act="retirer" data-i="${i}">Retirer</button></div>`).join('') || '<div class="muted">Aucun</div>'}</div>
    <div><b>Produit épinglé</b><div style="margin-top:6px">${productBlock()}</div><button class="ghost" style="margin-top:6px" data-act="sheet" data-s="epingler">Épingler / changer</button></div>
    <div><b>Modération</b><div class="muted">Touchez un message du chat pour le supprimer, shadowbannir ou bannir son auteur. Bannis : ${S.banned.length}</div></div>
    <div><button class="sdk" style="background:#e5484d;color:#fff" data-act="sheet" data-s="fin">Terminer le Live</button></div></div>`;
}

// ---------- écran « regarder » (Spectateur) / « animer » (Hôte), par variante ----------
const WATCH = {
  A: () => `<div class="scr vA">${videoHTML()}
    <div class="top row"><div class="hostpill">${avatar(host())}<div style="min-width:0"><div class="n">${esc(host()[0])} <span class="pill">${esc(T().label)}</span></div><div class="s">❤️ <span data-slot="rtotal">${S.reactionsTotal}</span></div></div></div>
      <div class="row"><span class="countpill" data-act="sheet" data-s="audience">👤 <span data-slot="aud">${audTotal()}</span></span><button class="close" data-act="sheet" data-s="${isAnim() ? 'fin' : 'quitter'}">✕</button></div></div>
    <div class="chatov ${S.product && !S.productHidden ? 'withprod' : ''}" data-slot="chat">${chatHTML()}</div>
    ${S.product && !S.productHidden ? `<div class="prodcard"><div class="img">${S.product.emoji}<span class="tagp">📌 Épinglé</span></div><div style="flex:1;display:flex;flex-direction:column;justify-content:space-between"><div style="padding-right:18px">${esc(S.product.name)}</div><div class="row" style="justify-content:space-between"><b style="font-size:18px">${S.product.price}</b>${isAnim() ? '<button class="ghost" style="color:#111" data-act="sheet" data-s="epingler">Changer</button>' : '<button class="sdk" data-act="sheet" data-s="achat">Acheter</button>'}</div></div><button class="x" data-act="hideprod">✕</button></div>` : ''}
    <div class="bottom"><button class="ico" data-act="sheet" data-s="boutique">🛍${S.product ? '<span class="badge">1</span>' : ''}<small>Produit</small></button>
      <input class="sdk" data-input="chat" placeholder="Commenter…">
      ${isAnim() ? `<button class="ico" data-act="sheet" data-s="gestion">⚙️${S.requests.length ? `<span class="badge">${S.requests.length}</span>` : ''}<small>Gestion</small></button>` : `<button class="ico" data-act="montee">${S.myRequest ? '⏳' : '✋'}<small>${S.myRequest ? 'Attente' : 'Monter'}</small></button>`}
      <button class="ico" data-act="react" data-r="❤️" data-long="reactions">❤️<small>Réagir</small></button></div>
    <div class="fx"></div></div>`,

  B: () => `<div class="scr vB">${videoHTML()}
    <div class="bar row"><span class="row">${avatar(host())}<b>${esc(host()[0])}</b> <span class="pill">${esc(T().label)}</span></span><span class="muted">👁 <span data-slot="aud">${audTotal()}</span> · ❤️ <span data-slot="rtotal">${S.reactionsTotal}</span></span></div>
    ${S.product ? `<div style="padding:8px 12px">${productBlock()}</div>` : ''}
    <div class="tabs">${['chat', 'audience', ...(isAnim() ? ['gestion'] : [])].map((t) => `<button class="${S.tab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${{ chat: 'Chat', audience: 'Audience', gestion: `Gestion${S.requests.length ? ` (${S.requests.length})` : ''}` }[t]}</button>`).join('')}</div>
    <div class="pane ${S.tab}" ${S.tab === 'chat' ? 'data-slot="chat"' : ''}>${S.tab === 'chat' ? chatHTML() : S.tab === 'audience' ? audienceDetail() : gestionHTML()}</div>
    <div class="reacts">${REACTIONS.map((r) => `<button data-act="react" data-r="${r}">${r}</button>`).join('')}</div>
    <div class="bottom row"><input class="sdk" data-input="chat" placeholder="Envoyer un message">${montee()}<button class="sdk" data-act="send">➤</button></div>
    <div class="fx"></div></div>`,

  C: () => {
    const last = S.chat.filter((m) => !(m.shadow && !isAnim())).slice(-2);
    return `<div class="scr vC">${videoHTML()}
    <div class="top row"><span class="pill">${esc(T().label)}</span><span class="row" style="gap:10px">👁 <span data-slot="aud">${audTotal()}</span><button class="close" style="background:none;border:0;color:#fff;font-size:20px" data-act="goto" data-s="liste">✕</button></span></div>
    ${S.product ? `<div class="prodpill row" data-act="sheet" data-s="${isAnim() ? 'epingler' : 'achat'}"><span class="avatar" style="background:#fff">${S.product.emoji}</span>${esc(S.product.name)} · <b>${S.product.price}</b></div>` : ''}
    <div class="ticker" data-slot="ticker">${last.map(msgHTML).join('')}</div>
    <div class="dock"><button data-act="sheet" data-s="chat">💬</button><button data-act="react" data-r="❤️" data-long="reactions">❤️</button><button data-act="sheet" data-s="reactions">😀</button>
      ${S.product ? '<button data-act="sheet" data-s="boutique">🛍</button>' : ''}<button data-act="sheet" data-s="audience">👥</button>
      ${isAnim() ? `<button data-act="sheet" data-s="gestion">⚙️${S.requests.length ? `<span class="badge">${S.requests.length}</span>` : ''}</button>` : `<button data-act="montee">${S.myRequest ? '⏳' : '✋'}</button>`}</div>
    <div class="fx"></div></div>`;
  },
};

// ---------- liste des Lives, par variante ----------
const visibleLives = () => LIVES.filter((l) => !S.filter || l.host[1] === S.filter);
const LIST = {
  A: () => { const l = LIVES[S.feedIdx % LIVES.length]; return `<div class="scr vA"><div class="video n1"><div class="tile">${l.emoji}</div></div>
    <div class="feed" data-act="rejoindre"></div>
    <div class="top row" style="pointer-events:none"><span class="pill">${esc(T().label)}</span><span>👁 ${l.aud}</span></div>
    <div style="position:absolute;left:14px;bottom:120px;color:#fff;z-index:3;pointer-events:none"><div class="row">${avatar(l.host)}<b>${esc(l.host[0])}</b>${appChip(l.host[1])}</div><div style="font-size:18px;margin-top:6px">${esc(l.title)}</div><div class="muted">Touchez pour rejoindre · ${LIVES.length} Lives en cours</div></div>
    <div style="position:absolute;right:12px;bottom:110px;z-index:3;display:flex;flex-direction:column;gap:8px"><button class="ghost" style="color:#fff" data-act="feed" data-d="-1">▲</button><button class="ghost" style="color:#fff" data-act="feed" data-d="1">▼</button></div>
    <div style="position:absolute;left:0;right:0;bottom:30px;text-align:center;z-index:3"><button class="sdk" data-act="goto" data-s="lancer">＋ Lancer mon Live</button></div></div>`; },
  B: () => `<div class="scr"><div class="listhead row" style="justify-content:space-between"><h1>Lives en cours</h1><button class="sdk" data-act="goto" data-s="lancer">＋</button></div>
    <div class="row" style="padding:0 12px 10px;flex-wrap:wrap;gap:4px"><button class="ghost" data-act="filter" data-a="">Toutes</button>${Object.keys(APPS).map((a) => `<span data-act="filter" data-a="${a}" style="cursor:pointer;opacity:${!S.filter || S.filter === a ? 1 : .4}">${appChip(a)}</span>`).join('')}</div>
    <div class="grid2">${visibleLives().map((l) => `<div class="thumb" data-act="rejoindre"><div class="row" style="justify-content:space-between"><span class="pill">${esc(T().label)}</span><span>👁 ${l.aud}</span></div><div style="font-size:44px;text-align:center">${l.emoji}</div><div><b>${esc(l.title)}</b><div class="row" style="margin-top:4px">${esc(l.host[0])} ${appChip(l.host[1])}</div></div></div>`).join('')}</div></div>`,
  C: () => `<div class="scr"><div class="listhead"><h1>Lives</h1></div>
    <div class="row" style="padding:0 16px 10px"><input class="sdk" placeholder="Coller un lien direct live.echimine.fr/l/…"><button class="ghost">Ouvrir</button></div>
    ${LIVES.map((l) => `<div class="lrow" data-act="rejoindre"><span style="font-size:30px">${l.emoji}</span><div style="flex:1"><b>${esc(l.title)}</b><div class="muted">${esc(l.host[0])} · ${APPS[l.host[1]].name}</div></div><span class="pill">${l.aud}</span></div>`).join('')}
    <div style="position:absolute;left:16px;right:16px;bottom:30px"><button class="sdk" style="width:100%" data-act="goto" data-s="lancer">Lancer un Live</button></div></div>`,
};

// ---------- lancer un Live, par variante ----------
const LAUNCH = {
  A: () => `<div class="scr vA"><div class="video n1"><div class="tile">🤳</div></div>
    <div class="top row"><button class="close" data-act="goto" data-s="liste">✕</button><button class="ghost" style="color:#fff">🔄 Caméra</button></div>
    <div style="position:absolute;left:16px;right:16px;bottom:140px;z-index:3"><input class="sdk" style="width:100%;background:rgba(0,0,0,.4);color:#fff" placeholder="Titre du Live (optionnel)"></div>
    <div style="position:absolute;left:0;right:0;bottom:40px;display:grid;place-items:center;z-index:3"><button class="shutter" data-act="lancer"></button><span style="color:#fff;margin-top:6px;font-size:13px">Lancer le ${esc(T().label)}</span></div></div>`,
  B: () => `<div class="scr form" style="padding:54px 16px 0"><h1 style="font-size:24px">Nouveau Live</h1>
    <div class="video n1" style="aspect-ratio:16/10;margin-top:12px;border-radius:var(--radius)"><div class="tile">🤳</div></div>
    <label>Titre</label><input class="sdk" value="Unboxing gourde isotherme">
    <label>Produit à épingler dès le début (optionnel)</label><div class="row"><input class="sdk" placeholder="Nom"><input class="sdk" placeholder="Prix" style="max-width:90px"></div>
    <div class="row" style="margin-top:20px"><button class="sdk" style="flex:1" data-act="lancer">Lancer</button><button class="ghost" data-act="goto" data-s="liste">Annuler</button></div></div>`,
  C: () => `<div class="scr vC"><div class="video n1"><div class="tile">🤳</div></div>
    <div class="sheet-bg" style="background:none"><div class="sheet"><div class="grab"></div><h3>Prêt à lancer ?</h3><div class="list"><div>✅ Caméra</div><div>✅ Micro</div><div>✅ Connexion au serveur</div></div>
    <button class="sdk" style="width:100%;margin-top:14px" data-act="lancer">Lancer dans 3 s</button></div></div></div>`,
};

// ---------- rendu ----------
function render() {
  const t = T(), ph = $('#phone');
  Object.entries({ accent: t.accent, accentFg: t.accentFg, bg: t.bg, fg: t.fg, surface: t.surface, font: t.font, radius: t.radius + 'px' }).forEach(([k, v]) => ph.style.setProperty('--' + k, v));
  const screens = { liste: LIST, lancer: LAUNCH, regarder: WATCH };
  let html = screens[S.screen][S.variant]();
  if (S.sheet && SHEETS[S.sheet]) html += `<div class="sheet-bg" data-act="close">${SHEETS[S.sheet]()}</div>`;
  if (S.sheet === 'quitter') html += `<div class="sheet-bg" data-act="close"><div class="sheet"><div class="grab"></div><h3>Quitter le Live ?</h3><div class="row"><button class="sdk" data-act="goto" data-s="liste">Quitter</button><button class="ghost" data-act="close">Rester</button></div></div></div>`;
  ph.innerHTML = html;
  scrollChat(); renderControls(); renderState();
  const u = new URL(location); ['variant', 'screen', 'app', 'role'].forEach((k) => u.searchParams.set(k, S[k])); history.replaceState(null, '', u);
}
function scrollChat() { document.querySelectorAll('[data-slot=chat]').forEach((el) => { el.scrollTop = el.scrollHeight; }); }
function refreshSlots() { // mises à jour en direct sans perdre le focus de saisie
  document.querySelectorAll('[data-slot=chat]').forEach((el) => { el.innerHTML = chatHTML(); });
  document.querySelectorAll('[data-slot=aud]').forEach((el) => { el.textContent = audTotal(); });
  document.querySelectorAll('[data-slot=rtotal]').forEach((el) => { el.textContent = S.reactionsTotal; });
  const tk = $('[data-slot=ticker]'); if (tk) tk.innerHTML = S.chat.filter((m) => !(m.shadow && !isAnim())).slice(-2).map(msgHTML).join('');
  scrollChat(); renderState();
}
function renderState() {
  $('#state').textContent = JSON.stringify({ variante: `${S.variant} — ${VARIANTS[S.variant]}`, écran: S.screen, rôle: S.role, appMembre: APPS[S.app].name, thème: T(),
    produitÉpinglé: S.product, achats: S.purchases, totalRéactions: S.reactionsTotal, audience: { total: audTotal(), ...S.audience },
    demandesDeMontée: S.requests.map((p) => p.join('@')), coHôtes: S.cohosts.map((p) => p.join('@')), maDemande: S.myRequest,
    bannis: S.banned, shadowbannis: S.shadow, derniersÉvénements: S.log }, null, 2);
}
function renderControls() {
  document.querySelectorAll('[data-ctl]').forEach((b) => b.classList.toggle('on', S[b.dataset.ctl] === b.dataset.v));
  $('#app').value = S.app; $('#switch-label').textContent = `${S.variant} (${VARIANTS[S.variant]})`;
  const t = T(); $('#accent').value = t.accent; $('#radius').value = t.radius; $('#label').value = t.label; $('#font').value = t.font;
}

// ---------- simulation ----------
function push(m) { m.id = ++S.seq; S.chat.push(m); if (S.chat.length > 60) S.chat.shift(); }
function fly(r) { const fx = $('.fx'); if (!fx) return; const s = document.createElement('span'); s.className = 'fly'; s.textContent = r;
  s.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px'); if (S.variant !== 'A') s.style.right = (20 + Math.random() * 40) + 'px'; fx.appendChild(s); setTimeout(() => s.remove(), 2300); }
function announce(who) { push({ kind: 'achat', who, text: S.product.name }); S.purchases++; log(`achat ${who.join('@')}`);
  const sc = $('.scr'); if (!sc) return; const b = document.createElement('div');
  if (S.variant === 'A') { b.className = 'banner'; b.textContent = `🛍 ${who[0]} vient d'acheter !`; } else { b.className = 'toast'; b.textContent = `🛍 ${who[0]} (${APPS[who[1]].name}) a acheté ${S.product.name}`; }
  sc.appendChild(b); setTimeout(() => b.remove(), 3500); }
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
setInterval(() => { if (S.screen !== 'regarder' || S.sheet === 'termine') return;
  const p = rnd(PEOPLE); if (S.banned.includes(p.join('@'))) return;
  const x = Math.random();
  if (x < .15) push({ kind: 'systeme', text: `${p[0]} (${APPS[p[1]].name}) a rejoint` });
  else if (x < .22 && S.product) { announce(p); }
  else push({ kind: 'msg', who: p, text: rnd(LINES), shadow: S.shadow.includes(p.join('@')) });
  refreshSlots(); }, 1600);
setInterval(() => { if (S.screen !== 'regarder') return; const r = rnd(REACTIONS); S.reactionsTotal++; fly(r); }, 700); // agrégées par 500 ms côté serveur
setInterval(() => { if (S.screen !== 'regarder') return; const a = rnd(Object.keys(S.audience)); S.audience[a] = Math.max(0, S.audience[a] + (Math.random() < .55 ? 1 : -1)); refreshSlots(); }, 2000);

// ---------- actions ----------
function send() { const i = $('[data-input=chat]'); if (!i || !i.value.trim()) return;
  push({ kind: 'msg', who: me(), text: i.value.trim(), shadow: false }); log('chat moi'); i.value = ''; refreshSlots(); }
const ACTS = {
  close: (e, el) => { if (e.target === el || el.tagName === 'BUTTON') { S.sheet = null; render(); } },
  sheet: (e, el) => { S.sheet = el.dataset.s; render(); },
  goto: (e, el) => { S.screen = el.dataset.s; S.sheet = null; render(); },
  tab: (e, el) => { S.tab = el.dataset.t; render(); },
  feed: (e, el) => { S.feedIdx = (S.feedIdx + LIVES.length + +el.dataset.d) % LIVES.length; render(); },
  filter: (e, el) => { S.filter = el.dataset.a || null; render(); },
  rejoindre: () => { S.screen = 'regarder'; S.role = 'spectateur'; S.sheet = null; log('join'); render(); },
  lancer: () => { S.screen = 'regarder'; S.role = 'hote'; S.sheet = null; log('lancement'); render(); },
  react: (e, el) => { S.reactionsTotal++; fly(el.dataset.r); log('réaction ' + el.dataset.r); if (S.sheet === 'reactions') { S.sheet = null; render(); } else refreshSlots(); },
  send,
  acheter: () => { S.sheet = 'achat'; render(); },
  'confirmer-achat': () => { S.sheet = null; render(); announce(me()); refreshSlots(); },
  hideprod: () => { S.productHidden = true; render(); },
  montee: () => { if (S.myRequest) return; S.myRequest = 'en_attente'; log('demande de montée'); render();
    setTimeout(() => { S.myRequest = null; push({ kind: 'systeme', text: "L'Hôte a refusé votre Demande de montée (simulé)" }); render(); }, 5000); },
  'annuler-montee': () => { S.myRequest = null; render(); },
  accepter: (e, el) => { const p = S.requests.splice(+el.dataset.i, 1)[0]; if (S.cohosts.length < 4) S.cohosts.push(p); log('montée acceptée ' + p.join('@')); render(); },
  refuser: (e, el) => { S.requests.splice(+el.dataset.i, 1); render(); },
  retirer: (e, el) => { const p = S.cohosts.splice(+el.dataset.i, 1)[0]; log('co-hôte retiré ' + p.join('@')); render(); },
  mod: (e, el) => { if (!isAnim()) return; S.sheet = 'mod'; S.sheetArg = +el.dataset.id; render(); },
  supprimer: () => { S.chat = S.chat.filter((m) => m.id !== S.sheetArg); S.sheet = null; log('message supprimé'); render(); },
  shadowban: () => { const m = S.chat.find((x) => x.id === S.sheetArg); const k = m.who.join('@');
    S.shadow = S.shadow.includes(k) ? S.shadow.filter((x) => x !== k) : [...S.shadow, k]; S.chat.forEach((x) => { if (x.who && x.who.join('@') === k) x.shadow = S.shadow.includes(k); }); S.sheet = null; log('shadowban ' + k); render(); },
  bannir: () => { const m = S.chat.find((x) => x.id === S.sheetArg); const k = m.who.join('@'); S.banned.push(k);
    S.chat = S.chat.filter((x) => !(x.who && x.who.join('@') === k)); push({ kind: 'systeme', text: `${m.who[0]} a été banni du Live` }); S.sheet = null; log('bannissement ' + k); render(); },
  epingler: () => { S.product = { name: $('[data-input=pname]').value, price: $('[data-input=pprice]').value, emoji: '🧢' }; S.productHidden = false; S.sheet = null; log('produit épinglé'); render(); },
  desepingler: () => { S.product = null; S.sheet = null; render(); },
  terminer: () => { S.sheet = 'termine'; log('fin du Live'); render(); },
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || !$('#phone').contains(el)) return;
  if (el.dataset.act === 'close' && e.target !== el) return; e.stopPropagation(); ACTS[el.dataset.act]?.(e, el); });
document.addEventListener('contextmenu', (e) => { const el = e.target.closest('[data-long]'); if (!el) return; e.preventDefault(); S.sheet = el.dataset.long; render(); });
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, [contenteditable]');
  if (e.key === 'Enter' && e.target.matches('[data-input=chat]')) send();
  if (typing) return;
  if (e.key === 'ArrowRight') cycle(1); if (e.key === 'ArrowLeft') cycle(-1);
});
function cycle(d) { const k = Object.keys(VARIANTS); S.variant = k[(k.indexOf(S.variant) + d + k.length) % k.length]; S.sheet = null; render(); }

// panneau de gauche
document.querySelectorAll('[data-ctl]').forEach((b) => b.addEventListener('click', () => { S[b.dataset.ctl] = b.dataset.v; S.sheet = null; render(); }));
$('#app').addEventListener('change', (e) => { S.app = e.target.value; S.theme = null; render(); });
const over = (k, v) => { S.theme = { ...(S.theme || {}), [k]: v }; render(); };
$('#accent').addEventListener('input', (e) => over('accent', e.target.value));
$('#radius').addEventListener('input', (e) => over('radius', +e.target.value));
$('#label').addEventListener('change', (e) => over('label', e.target.value));
$('#font').addEventListener('change', (e) => over('font', e.target.value));
$('#prev').addEventListener('click', () => cycle(-1)); $('#next').addEventListener('click', () => cycle(1));

push({ kind: 'systeme', text: 'Nora (clone_instagram) a rejoint' });
push({ kind: 'msg', who: ['Léa', 'twitch'], text: 'Salut tout le monde 👋' });
push({ kind: 'msg', who: ['Eliott', 'twitch'], text: 'Bienvenue ! Aujourd\'hui on teste la gourde isotherme 🧴' });
render();
