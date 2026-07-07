FROM oven/bun:1
WORKDIR /app
RUN mkdir -p /data/sessions
COPY package.json ./
RUN bun install
COPY . .
RUN bunx prisma generate
ENV SESSIONS_DIR=/data/sessions
CMD ["sh", "-c", "exec bun index.ts"]
