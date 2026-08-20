FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    openjdk-21-jdk \
    python3 \
    python3-pip \
    nodejs \
    npm \
    golang-go \
    php-cli \
    rustc \
    cargo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY server.js ./

EXPOSE 10000

CMD ["node", "server.js"]