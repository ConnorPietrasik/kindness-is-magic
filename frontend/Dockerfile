# syntax=docker/dockerfile:1

# --- Dev: Vite dev server (used by docker-compose.yml with source mounted) ---
FROM node:20-alpine AS dev
WORKDIR /app
# npm install runs at container start so mounted source changes are picked up.
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "npm install && npm run dev -- --host 0.0.0.0 --port 3000"]

# --- Build: compile the static bundle ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Prod: serve the static bundle with nginx (used by docker-compose.prod.yml) ---
FROM nginx:alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
