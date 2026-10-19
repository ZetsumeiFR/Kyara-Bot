# kyara-bot

Ouvre automatiquement les boosters gratuits de https://kyara.games dès que les 10 boosters gratuits sont rechargés (1 toutes les 10 min, plafond 10), par lots de 10, pour n'en perdre aucun, puis recycle les doublons (1 exemplaire gardé par carte ; Légendaires et Mythiques jamais recyclées par défaut).

Le bot pilote un Chromium furtif (patchright) qui résout le Turnstile Cloudflare du jeu. Il ne dépense jamais de chakra (`maxChakra: 0`).

Entre deux sessions, le navigateur est fermé. Le bot se réveille 15 à 90 s après l'heure où le plafond est atteint, calculée depuis `nextFreeAt` et la recharge du jeu (`/api/config`, boosts d'événement et bonus d'abonnement compris).

## Configuration

Copie `.env.example` en `.env` :

| Variable | Défaut | Rôle |
|---|---|---|
| `KYARA_TOKEN` | requis | clé `kyara_token` du Local Storage de kyara.games |
| `KYARA_DEVICE_ID` | requis | clé `kyara_device` du Local Storage |
| `BATCH_SIZE` | `10` | taille max d'un lot ouvert d'un coup |
| `RECYCLE_RARITIES` | `C,U,R,E` | raretés dont les doublons sont recyclés (vide = aucun recyclage) |
| `PACK_ID` | `waifu` | booster ouvert (`all` = Shōnen Mix) |
| `HEADLESS` | `false` | `true` pour un Chromium sans fenêtre (Turnstile échoue plus souvent) |

## Lancer en local

```bash
bun install
bunx patchright install chromium
bun run index.ts          # en boucle
bun run index.ts --once   # un seul cycle
```

## Déployer sur le VPS (Docker)

```bash
scp -r Dockerfile docker-compose.yml .dockerignore package.json bun.lock index.ts kyara.ts tsconfig.json .env user@vps:~/kyara-bot/
ssh user@vps
cd ~/kyara-bot && docker compose up -d --build
docker compose logs -f     # ou tail -f logs/kyara-bot.log
docker compose run --rm kyara-bot --once   # un seul cycle, pour tester
```

Si les logs affichent `JETON EXPIRÉ`, récupère un nouveau `kyara_token` dans ton navigateur, mets à jour `.env`, puis `docker compose up -d`.
