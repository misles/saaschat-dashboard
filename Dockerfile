### STAGE 1: Build ###
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# ✅ FIXED: Use npm install instead of npm ci for --legacy-peer-deps
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build Angular app
RUN npm run ng build -- --configuration production --output-path=dist --base-href ./

### STAGE 2: Setup ###
FROM nginx:1.24-alpine

# Install envsubst for config templating
RUN apk add --no-cache gettext

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Clear default nginx content
RUN rm -rf /usr/share/nginx/html/*

# ✅ IMPORTANT: Check your actual dist folder structure
# Angular creates dist/your-app-name/ not just dist/
COPY --from=builder /app/dist/tiledesk-dashboard /usr/share/nginx/html

# Startup command
CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]