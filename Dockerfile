FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    openjdk-21-jdk \
    python3 \
    python3-pip \
    python-is-python3 \
    nodejs \
    npm \
    golang-go \
    php-cli \
    rustc \
    cargo \
    dotnet-sdk-8.0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN gcc --version && \
    g++ --version && \
    java -version && \
    javac -version && \
    python --version && \
    node --version && \
    npm --version && \
    go version && \
    php --version && \
    rustc --version && \
    cargo --version

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]