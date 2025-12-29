### STAGE 1: Build ###
FROM node:18.20.8-alpine AS builder

WORKDIR /app

# Copy only dependency files first
COPY package.json package-lock.json ./

# Install deps (ignore peer conflicts)
RUN npm ci --legacy-peer-deps

# Verify Angular CLI is present
RUN ls node_modules/@angular/cli/bin/ng 2>/dev/null || (echo "WARNING: Angular CLI not found in node_modules" && false)

# Copy source
COPY . .

# Build using local Angular CLI + memory
RUN node --max_old_space_size=4096 \
  ./node_modules/@angular/cli/bin/ng build \
  --configuration production \
  --output-path=dist \
  --base-href ./

### STAGE 2: Runtime ###
FROM nginx:1.24-alpine

COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["/bin/sh", "-c", \
  "envsubst < /usr/share/nginx/html/dashboard-config-template.json > \
   /usr/share/nginx/html/dashboard-config.json && \
   exec nginx -g 'daemon off;'"]
