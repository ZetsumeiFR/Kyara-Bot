FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
 && bunx patchright install --with-deps chromium \
 && apt-get install -y --no-install-recommends xvfb \
 && rm -rf /var/lib/apt/lists/*

COPY index.ts kyara.ts tsconfig.json ./

ENV HEADLESS=false LOG_DIR=/app/logs PROFILE_DIR=/app/profile DISPLAY=:99
ENTRYPOINT ["sh", "-c", "Xvfb :99 -screen 0 1280x800x24 -nolisten tcp & sleep 1; exec bun run index.ts \"$@\"", "--"]
