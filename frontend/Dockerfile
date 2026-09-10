# syntax=docker/dockerfile:1
# ---- build ----------------------------------------------------------------
# Angular 22 needs Node ^22.22 || ^24.15 || >=26; 24 is the current LTS line.
FROM node:24-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx ng build --configuration production

# ---- runtime --------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Where nginx forwards /api and /health. Override with -e API_URL=http://host:port
ENV API_URL=http://backend:8080

# The nginx image runs envsubst on /etc/nginx/templates/*.template at start-up.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
