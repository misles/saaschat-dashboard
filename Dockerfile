### STAGE 1: Build ###
FROM node:18.20.8-alpine AS builder

WORKDIR /ng-app

# copy only deps first
COPY package.json package-lock.json ./

# install deps (tolerate peer conflicts)
RUN npm ci --legacy-peer-deps

# copy rest of source
COPY . .

# build using local angular cli
RUN node --max_old_space_size=4096 \
  ./node_modules/@angular/cli/bin/ng build \
  --configuration production \
  --output-path=dist \
  --base-href ./

### STAGE 2: Nginx ###
FROM nginx:1.14.1-alpine

COPY nginx.conf /etc/nginx/nginx.conf

RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /ng-app/dist /usr/share/nginx/html

CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]
