FROM node:18-alpine AS base

FROM base AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

FROM base AS app
WORKDIR /app
COPY package* .
COPY --from=builder /app/build ./build
RUN npm install --omit=dev
ENV NODE_ENV production
CMD npm run start
