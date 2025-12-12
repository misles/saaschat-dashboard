### STAGE 1: Build ###
FROM node:14-alpine as builder

# 1. Set working directory FIRST
WORKDIR /app

# 2. Copy package files
COPY package.json package-lock.json ./

# === DEBUG: Confirm files exist ===
RUN ls -la && echo "=== First 5 lines of package.json ===" && head -5 package.json

# 3. Install dependencies (using npm install instead of npm ci)
RUN npm install --legacy-peer-deps --no-audit --progress=false

# 4. Copy app source
COPY . .

# 5. Build the angular app
RUN npm run build

### STAGE 2: Setup ###
FROM nginx:1.14.1-alpine

## Copy our default nginx config
COPY nginx.conf /etc/nginx/nginx.conf

## Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

## From 'builder' stage copy over the artifacts in dist folder to default nginx public folder
COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["/bin/sh",  "-c",  "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]