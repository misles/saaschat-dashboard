### STAGE 1: Build ###
FROM node:14-alpine as builder

# 1. Copy package files
COPY package.json package-lock.json ./

# 2. Install dependencies WITH FALLBACK
RUN npm ci --legacy-peer-deps --no-audit --progress=false || \
    (echo "npm ci failed, falling back to npm install..." && \
     rm -f package-lock.json && \
     npm install --legacy-peer-deps --no-audit --progress=false) && \
    mkdir /ng-app && mv ./node_modules ./ng-app

WORKDIR /ng-app

# 3. Copy app source
COPY . .

# 4. Build the angular app
RUN npm run ng build -- --configuration production --output-path=dist --base-href ./

### STAGE 2: Setup ###
FROM nginx:1.14.1-alpine

COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /ng-app/dist /usr/share/nginx/html

CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]