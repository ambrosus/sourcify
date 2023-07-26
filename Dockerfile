FROM node:latest

WORKDIR /etc/sourcify

COPY . .

COPY configs/chains/* src/
COPY configs/.env environments/.env

RUN npm install

RUN npx lerna bootstrap

RUN npx lerna run build
