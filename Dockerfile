FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
 && bunx patchright install --with-deps chromium \
 && apt-get install -y --no-install-recommends xvfb xauth \
 && rm -rf /var/lib/apt/lists/*

COPY index.ts kyara.ts tsconfig.json ./

ENV HEADLESS=false LOG_DIR=/app/logs PROFILE_DIR=/app/profile
ENTRYPOINT ["xvfb-run", "-a", "-s", "-screen 0 1280x800x24 -nolisten tcp", "bun", "run", "index.ts"]
