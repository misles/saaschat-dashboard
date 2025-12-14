### STAGE 1: Build ###
FROM node:14-alpine as builder

# 1. Set working directory FIRST
WORKDIR /app

# 2. Copy package files
COPY package.json package-lock.json ./

# 3. Install dependencies (with fallback)
RUN npm ci --legacy-peer-deps --no-audit --progress=false || \
    (echo "npm ci failed, falling back to npm install..." && \
     rm -f package-lock.json && \
     npm install --legacy-peer-deps --no-audit --progress=false)
     
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

## Copy built artifacts
COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["/bin/sh",  "-c",  "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]