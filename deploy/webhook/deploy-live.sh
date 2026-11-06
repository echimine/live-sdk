#!/usr/bin/env bash
# Déploiement de live.echimine.fr, lancé par le hook `deploy-live` (hooks.deploy-live.json).
# À déposer sur le VPS dans /opt/proxy/webhook/deploy-live.sh, monté en
# /scripts/deploy-live.sh:ro dans le conteneur webhook.
# Entrée : IMAGE_TAG (SHA du commit, depuis le payload). Le répertoire courant est
# le dossier compose (command-working-directory du hook), sauf si APP_DIR est fourni.
# Requiert bash, docker compose, jq, curl, timeout, flock.
set -Eeuo pipefail
[[ -n "${APP_DIR:-}" ]] && cd "$APP_DIR"
APP_NAME=${APP_NAME:-$(basename "$(dirname "$PWD")")}
DEPLOY_TIMEOUT=${DEPLOY_TIMEOUT:-300}
DISCORD_WEBHOOK_FILE=${DISCORD_WEBHOOK_FILE:-.discord-webhook-url}
SERVICES="db server livekit"
phase=configuration

notify() {
  local url payload
  url=$(cat "$DISCORD_WEBHOOK_FILE") || return 1
  [[ "$url" == https://discord.com/api/webhooks/* && "$url" != *$'\n'* && "$url" != *'"'* && "$url" != *'\'* && "$url" != *$'\r'* ]] || return 1
  payload=$(jq -nc --arg content "$1" '{content: $content, allowed_mentions: {parse: []}}') || return 1
  # URL via stdin pour ne pas exposer le secret dans la liste des processus.
  printf 'url = "%s?wait=true"\n' "${url%%\?*}" |
    curl --config - --silent --fail --connect-timeout 5 --max-time 15 \
      -H 'Content-Type: application/json' --data "$payload" --output /dev/null
}

finish() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    printf '[deploy] ÉCHEC : %s (code %s)\n' "$phase" "$rc" >&2
    notify "❌ $APP_NAME : déploiement de ${IMAGE_TAG:-?} échoué à l’étape $phase (code $rc). Consulter les logs du webhook." ||
      echo '[deploy] Notification Discord non remise.' >&2
  fi
  exit "$rc"
}

for dependency in docker jq curl timeout flock; do
  command -v "$dependency" >/dev/null || { echo "Dépendance absente : $dependency" >&2; exit 1; }
done
[[ "$DEPLOY_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || { echo 'DEPLOY_TIMEOUT invalide.' >&2; exit 1; }
[[ -s "$DISCORD_WEBHOOK_FILE" ]] || { echo 'Fichier webhook Discord absent/vide.' >&2; exit 1; }
[[ "${IMAGE_TAG:-}" =~ ^[0-9a-f]{7,40}$ ]] || { echo 'IMAGE_TAG absent ou invalide (SHA attendu).' >&2; exit 1; }
export IMAGE_TAG

# Même verrou pour tous les appels utilisant ce répertoire : aucun déploiement concurrent.
lock_key=$(printf %s "$PWD" | cksum | cut -d' ' -f1)
exec 9>"/tmp/deploy-$lock_key.lock"
flock -n 9 || { echo '[deploy] Déploiement déjà en cours.' >&2; exit 1; }
trap finish EXIT

read -r -a services <<< "$SERVICES"

phase="pull ($IMAGE_TAG)"
timeout "$DEPLOY_TIMEOUT" docker compose pull "${services[@]}"

phase='démarrage / attente healthy (timeout ou unhealthy)'
timeout "$DEPLOY_TIMEOUT" docker compose up -d --wait --wait-timeout "$DEPLOY_TIMEOUT" "${services[@]}"

# Compose accepte running sans healthcheck : inspection stricte de chaque conteneur.
phase='vérification finale des conteneurs attendus'
for service in "${services[@]}"; do
  ids=$(timeout 15 docker compose ps --all -q "$service")
  [[ -n "$ids" ]] || exit 1
  while IFS= read -r id; do
    state=$(timeout 15 docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$id")
    [[ "$state" == 'running healthy' ]] || { echo "[deploy] $service : $state" >&2; exit 1; }
  done <<< "$ids"
done

phase='notification Discord (conteneurs healthy)'
# Un échec de remise reste un code non nul, sans annoncer à tort un échec applicatif.
trap - EXIT
notify "✅ $APP_NAME : $IMAGE_TAG déployé, services $SERVICES healthy." || {
  echo '[deploy] Conteneurs healthy, mais notification Discord non remise.' >&2
  exit 1
}
echo "[deploy] done : $IMAGE_TAG déployé, tous les conteneurs attendus sont healthy."
