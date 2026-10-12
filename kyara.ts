import { chromium, type BrowserContext, type Page } from "patchright";

const ORIGIN = "https://kyara.games";
// Blank page served on the kyara.games origin: Turnstile accepts the domain and
// same-origin /api calls work, without running the site's app (which would
// replace an expired token with a fresh guest account).
const BLANK_URL = `${ORIGIN}/__kyara_bot`;
const PASS_MARGIN_MS = 5 * 60_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(`${status} ${code}${message ? `: ${message}` : ""}`);
  }
}

export type Card = { id: number | string; rarity: string; name?: string; num?: string };
export type User = {
  pseudo?: string;
  chakra?: number;
  freePacks?: number;
  freePacksMax?: number;
  bonusPacks?: number;
  nextFreeAt?: string;
};
type Pull = { cards: Card[]; user: User };

export class Kyara {
  private context?: BrowserContext;
  private page?: Page;
  private pass?: { pass: string; expiresAt: number };

  constructor(
    private readonly token: string,
    private readonly deviceId: string,
    private readonly headless: boolean,
    private readonly profileDir: string,
  ) {}

  async start(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profileDir, { headless: this.headless, viewport: null });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.route(BLANK_URL, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang=fr><head><title>Kyara</title></head><body></body></html>" }),
    );
    await this.page.goto(BLANK_URL);
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = undefined;
    this.page = undefined;
  }

  private async api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    if (!this.page) throw new Error("navigateur non démarré");
    const res = await this.page.evaluate(
      async ({ path, method, body, headers, token, deviceId }) => {
        const r = await fetch(`/api${path}`, {
          method: method ?? "GET",
          headers: {
            ...headers,
            "x-device-id": deviceId,
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.status, text: await r.text() };
      },
      { path, ...init, token: this.token, deviceId: this.deviceId },
    );
    let data: any = null;
    try {
      data = res.text ? JSON.parse(res.text) : null;
    } catch {}
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, data?.error ?? `http_${res.status}`, data?.message ?? res.text.slice(0, 200));
    }
    return data as T;
  }

  async me(): Promise<User> {
    const data = await this.api<any>("/me");
    return data?.user ?? data;
  }

  private async turnstile(): Promise<string> {
    const { turnstile: sitekey } = await this.api<{ turnstile?: string }>("/auth/providers");
    if (!sitekey) throw new Error("pas de clé Turnstile annoncée par le serveur");
    const token = this.page!.evaluate(
      (sitekey) =>
        new Promise<string>((resolve, reject) => {
          const w = window as any;
          const render = () => {
            const box = document.createElement("div");
            box.id = "kyara-ts";
            document.body.appendChild(box);
            const timer = setTimeout(() => reject(new Error("turnstile_timeout")), 90_000);
            w.turnstile.render(box, {
              sitekey,
              appearance: "interaction-only",
              callback: (t: string) => (clearTimeout(timer), box.remove(), resolve(t)),
              "error-callback": (code: string) => (clearTimeout(timer), box.remove(), reject(new Error(`turnstile_failed ${code}`))),
              "timeout-callback": () => (clearTimeout(timer), box.remove(), reject(new Error("turnstile_expired"))),
            });
          };
          if (w.turnstile) return render();
          const s = document.createElement("script");
          s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          s.onload = render;
          s.onerror = () => reject(new Error("turnstile_unavailable"));
          document.head.appendChild(s);
        }),
      sitekey,
      undefined,
      false,
    );
    let settled = false;
    token.finally(() => (settled = true)).catch(() => {});
    await this.clickCheckboxWhenShown(() => settled);
    return token;
  }

  private async clickCheckboxWhenShown(settled: () => boolean): Promise<void> {
    const page = this.page!;
    while (!settled()) {
      await Bun.sleep(1000);
      const box = await page.locator("#kyara-ts").boundingBox().catch(() => null);
      if (box && box.height > 30) {
        await page.mouse.move(box.x + 20 + Math.random() * 20, box.y + box.height / 2 + Math.random() * 6 - 3, { steps: 20 });
        await page.mouse.down();
        await Bun.sleep(60 + Math.random() * 80);
        await page.mouse.up();
        return;
      }
    }
  }

  private async ensurePass(force = false): Promise<string> {
    if (!force && this.pass && this.pass.expiresAt - Date.now() > PASS_MARGIN_MS) return this.pass.pass;
    const turnstile = await this.turnstile();
    this.pass = await this.api<{ pass: string; expiresAt: number }>("/auth/pass", { method: "POST", body: { turnstile } });
    return this.pass.pass;
  }

  /** Opens `count` boosters paid only with free packs (maxChakra 0: never spends chakra). */
  async openFree(packId: string, count: number): Promise<{ pulls: Pull[]; stopped?: { code?: string; message?: string } }> {
    const attempt = async (force: boolean) => {
      const headers = { "x-pass": await this.ensurePass(force), "x-request-id": crypto.randomUUID().replace(/-/g, "") };
      const id = encodeURIComponent(packId);
      if (count === 1) {
        const pull = await this.api<Pull>(`/packs/${id}/open`, { method: "POST", body: { maxChakra: 0 }, headers });
        return { pulls: [pull] };
      }
      const r = await this.api<{ results: Pull[]; stopped?: { code?: string; message?: string } }>(`/packs/${id}/open-many`, {
        method: "POST",
        body: { count, maxChakra: 0 },
        headers,
      });
      return { pulls: r.results, stopped: r.stopped };
    };
    try {
      return await attempt(false);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "pass_required")) throw e;
      return attempt(true);
    }
  }

  async recycleDuplicates(rarities: string[]): Promise<{ recycled: number; chakra: number }> {
    let recycled = 0;
    const before = (await this.me()).chakra;
    let after = before;
    for (let i = 0; i < 100; i++) {
      const r = await this.api<{ user: User; entries: unknown[]; left: number }>("/me/collection/recycle-all", {
        method: "POST",
        body: { rarities },
      });
      after = r.user?.chakra ?? after;
      recycled += r.entries.length;
      if (!r.entries.length || !r.left) break;
    }
    return { recycled, chakra: before !== undefined && after !== undefined ? after - before : 0 };
  }
}
