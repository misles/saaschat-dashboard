### STAGE 1: Build ###
FROM node:18-alpine AS builder

# Copy package files first
COPY package.json package-lock.json ./

## Storing node modules on a separate layer will prevent unnecessary npm installs at each build
RUN npm ci --legacy-peer-deps && mkdir /ng-app && mv ./node_modules ./ng-app

WORKDIR /ng-app

COPY . .

## Build the angular app in production mode
RUN npm run ng build -- --configuration production --output-path=dist --base-href ./

### STAGE 2: Setup ###
FROM nginx:1.24-alpine

## Install envsubst (CRITICAL - was missing!)
RUN apk add --no-cache gettext

## Copy our default nginx config
COPY nginx.conf /etc/nginx/nginx.conf

## Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

## From 'builder' stage copy over the artifacts in dist folder to default nginx public folder
## FIXED PATH: Angular creates dist/tiledesk-dashboard/, not just dist/
COPY --from=builder /ng-app/dist/saaschat-dashboard /usr/share/nginx/html

## CMD with envsubst - now will work because gettext is installed
CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/dashboard-config-template.json > /usr/share/nginx/html/dashboard-config.json && exec nginx -g 'daemon off;'"]