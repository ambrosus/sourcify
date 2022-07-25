FROM node:16-alpine

WORKDIR /etc/sourcify

ADD . ./

COPY configs/chains/* services/core/src/
COPY configs/.env environments/.env

RUN npx lerna bootstrap && npx lerna run build
