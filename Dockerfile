### STAGE 1: Build ###
FROM node:18.20.8-alpine AS builder

WORKDIR /app

# 1. Copy package files first (cache layer)
COPY package.json package-lock.json ./

# 2. Install dependencies safely
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit

# 3. Copy the rest of your source code
COPY . .

# 4. Build the Angular application
RUN node --max_old_space_size=4096 \
  ./node_modules/.bin/ng build \
  --configuration production \
  --output-path=dist \
  --base-href ./

### STAGE 2: Runtime ###
FROM nginx:1.24-alpine

COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]