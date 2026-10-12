import { appendFileSync, mkdirSync } from "node:fs";
import { ApiError, Kyara } from "./kyara";

const token = process.env.KYARA_TOKEN;
const deviceId = process.env.KYARA_DEVICE_ID;
if (!token || !deviceId) {
  console.error("KYARA_TOKEN et KYARA_DEVICE_ID sont requis (voir .env.example)");
  process.exit(1);
}

const PACK_ID = process.env.PACK_ID ?? "waifu";
const INTERVAL_MS = Number(process.env.INTERVAL_MINUTES ?? 10) * 60_000;
const JITTER_MS = 90_000;
const RECYCLE_RARITIES = (process.env.RECYCLE_RARITIES ?? "C,U,R,E").split(",").map((r) => r.trim()).filter(Boolean);
const HEADLESS = process.env.HEADLESS === "true";
const ONCE = process.argv.includes("--once");
const LOG_DIR = process.env.LOG_DIR ?? "logs";
const PROFILE_DIR = process.env.PROFILE_DIR ?? "profile";

mkdirSync(LOG_DIR, { recursive: true });
function log(msg: string) {
  const line = `[${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}] ${msg}`;
  console.log(line);
  appendFileSync(`${LOG_DIR}/kyara-bot.log`, line + "\n");
}

let kyara: Kyara | undefined;

async function cycle() {
  if (!kyara) {
    kyara = new Kyara(token!, deviceId!, HEADLESS, PROFILE_DIR);
    await kyara.start();
  }
  const user = await kyara.me();
  const available = (user.freePacks ?? 0) + (user.bonusPacks ?? 0);
  log(`${user.pseudo ?? "?"} : ${user.freePacks ?? 0}/${user.freePacksMax ?? "?"} boosters gratuits, ${user.bonusPacks ?? 0} bonus, ${user.chakra ?? "?"} chakra`);

  if (available > 0) {
    const { pulls, stopped } = await kyara.openFree(PACK_ID, available);
    for (const pull of pulls) log(`booster : ${pull.cards.map((c) => `[${c.rarity}] ${c.name ?? c.id}`).join(", ")}`);
    if (stopped) log(`ouverture arrêtée : ${stopped.code ?? ""} ${stopped.message ?? ""}`);
  }

  if (RECYCLE_RARITIES.length) {
    const { recycled, chakra } = await kyara.recycleDuplicates(RECYCLE_RARITIES);
    if (recycled) log(`recyclage ${RECYCLE_RARITIES.join("/")} : ${recycled} entrées, +${chakra} chakra`);
  }
}

while (true) {
  try {
    await cycle();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      log("JETON EXPIRÉ : mets à jour KYARA_TOKEN dans .env puis redémarre le conteneur");
    } else {
      log(`erreur : ${e instanceof Error ? e.message : String(e)}`);
      await kyara?.close();
      kyara = undefined;
    }
  }
  if (ONCE) break;
  await Bun.sleep(INTERVAL_MS + Math.random() * JITTER_MS);
}
await kyara?.close();
