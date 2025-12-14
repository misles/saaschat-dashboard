### STAGE 1: Build ###
FROM node:14-alpine as builder

# 1. Set working directory FIRST
WORKDIR /app

# 2. Copy package files
COPY package.json package-lock.json ./

# === DEBUG: MUST BE HERE - BEFORE npm ci ===
# Check if files exist and show their content
RUN ls -la && echo "=== File check ===" && \
    [ -f package.json ] && echo "package.json exists" || echo "package.json MISSING!" && \
    [ -f package-lock.json ] && echo "package-lock.json exists" || echo "package-lock.json MISSING!" && \
    echo "=== First 5 lines of package.json ===" && \
    head -5 package.json 2>/dev/null || echo "Cannot read package.json"

# 3. Now try npm ci
RUN npm ci --legacy-peer-deps

# 4. Copy app source
COPY . .

# 5. Build the angular app
RUN npm run build

## Build the angular app in production mode and store the artifacts in dist folder

#RUN npm run ng build -- --output-path=dist --base-href ./

# with prod option
#RUN npm run ng build -- --prod --output-path=dist --base-href ./
# RUN node --max_old_space_size=8192 node_modules/@angular/cli/bin/ng --configuration production --output-path=dist --base-href ./
#RUN npm run ng build -- --configuration production --output-path=dist --base-href ./
RUN npm run build

### STAGE 2: Setup ###
FROM nginx:1.14.1-alpine

## Copy our default nginx config
COPY nginx.conf /etc/nginx/nginx.conf

## Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

## From ‘builder’ stage copy over the artifacts in dist folder to default nginx public folder
## FIXED PATH: /app/dist NOT /ng-app/dist
COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["/bin/sh",  "-c",  "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]