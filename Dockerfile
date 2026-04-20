# Dockerfile
# Multi-stage build — keeps the final image lean
# Stage 1: install dependencies
# Stage 2: build Next.js
# Stage 3: production runtime only

# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files only — maximizes layer cache on rebuilds
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args are injected at build time for the Next.js production build
# These are server-side only — never exposed to the browser
#ARG MIKROTIK_HOST
#ARG MIKROTIK_USER
#ARG MIKROTIK_PASS

#ENV MIKROTIK_HOST=$MIKROTIK_HOST
#ENV MIKROTIK_USER=$MIKROTIK_USER
#ENV MIKROTIK_PASS=$MIKROTIK_PASS

RUN npm run build

# ---- Stage 3: runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Force Node.js runtime — required for rejectUnauthorized: false in mikrotik.ts
ENV NEXT_RUNTIME=nodejs

# Create non-root user — good practice for container security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy only what's needed to run the app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]