# Frontend container (Vite build -> Nginx)

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml /app/
COPY .yarn /app/.yarn
COPY ./ /app/

RUN corepack enable && yarn install --immutable

# Build Vite app
RUN yarn build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# SPA: serve index.html for all routes (HashRouter works anyway, but keep fallback)
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
