import { appendFileSync, mkdirSync } from "node:fs";
import { ApiError, Kyara, type User } from "./kyara";

const token = process.env.KYARA_TOKEN;
const deviceId = process.env.KYARA_DEVICE_ID;
if (!token || !deviceId) {
  console.error("KYARA_TOKEN et KYARA_DEVICE_ID sont requis (voir .env.example)");
  process.exit(1);
}

const PACK_ID = process.env.PACK_ID ?? "waifu";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 10);
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

const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** Short "human" hesitation between two actions. */
const hesitate = () => Bun.sleep(rand(2_000, 12_000));
const at = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/** When the free packs reach the cap: the server's next-pack time plus one regen period per missing pack. */
function fullAt(user: User, regenMs: number, now = Date.now()): number {
  const free = user.freePacks ?? 0;
  const max = user.freePacksMax ?? 10;
  if (free >= max) return now;
  const next = user.nextFreeAt ? Date.parse(user.nextFreeAt) : now + regenMs;
  return next + (max - free - 1) * regenMs;
}

let kyara: Kyara | undefined;

/** Runs one session and returns when the next one should start. */
async function cycle(): Promise<number> {
  if (!kyara) {
    kyara = new Kyara(token!, deviceId!, HEADLESS, PROFILE_DIR);
    await kyara.start();
  }
  const user = await kyara.me();
  log(`${user.pseudo ?? "?"} : ${user.freePacks ?? 0}/${user.freePacksMax ?? "?"} boosters gratuits, ${user.bonusPacks ?? 0} bonus, ${user.chakra ?? "?"} chakra`);

  // Open only once the free packs hit the cap (bonus packs go along), by batches of BATCH_SIZE.
  let left = (user.freePacks ?? 0) >= (user.freePacksMax ?? 10) ? (user.freePacks ?? 0) + (user.bonusPacks ?? 0) : 0;
  while (left > 0) {
    await hesitate();
    const count = Math.min(BATCH_SIZE, left);
    const { pulls, stopped } = await kyara.openFree(PACK_ID, count);
    log(`ouverture x${count}`);
    for (const pull of pulls) log(`booster : ${pull.cards.map((c) => `[${c.rarity}] ${c.name ?? c.id}`).join(", ")}`);
    if (stopped) {
      log(`ouverture arrêtée : ${stopped.code ?? ""} ${stopped.message ?? ""}`);
      break;
    }
    left -= count;
  }

  if (RECYCLE_RARITIES.length) {
    await hesitate();
    const { recycled, chakra } = await kyara.recycleDuplicates(RECYCLE_RARITIES);
    if (recycled) log(`recyclage ${RECYCLE_RARITIES.join("/")} : ${recycled} entrées, +${chakra} chakra`);
  }

  const after = await kyara.me();
  return fullAt(after, await kyara.regenMs(after));
}

while (true) {
  // Errors retry soon: every minute past the cap is regen lost.
  let wakeAt = Date.now() + rand(2, 5) * 60_000;
  try {
    // A few seconds to a minute and a half late, like someone answering the notification.
    wakeAt = (await cycle()) + rand(15_000, 90_000);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      log("JETON EXPIRÉ : mets à jour KYARA_TOKEN dans .env puis redémarre le conteneur");
    } else {
      log(`erreur : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // The browser stays closed between sessions, like a closed tab.
  await kyara?.close();
  kyara = undefined;
  if (ONCE) break;
  log(`prochaine session vers ${at(wakeAt)}`);
  await Bun.sleep(Math.max(0, wakeAt - Date.now()));
}
