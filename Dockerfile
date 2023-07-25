FROM node:16-alpine

WORKDIR /etc/sourcify

COPY . .

COPY configs/chains/* services/core/src/
COPY configs/.env environments/.env

RUN npm install -g lerna

RUN lerna clean --yes && \
    lerna exec -- npm install && \
    lerna bootstrap