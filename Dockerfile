FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# =========================================
# INSTALL ALL LANGUAGES
# =========================================

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
    ca-certificates \
    curl \
    coreutils \
    && rm -rf /var/lib/apt/lists/*

# =========================================
# VERIFY INSTALLATIONS
# =========================================

RUN gcc --version && \
    g++ --version && \
    java -version && \
    javac -version && \
    python3 --version && \
    node --version && \
    npm --version && \
    go version && \
    php --version && \
    rustc --version && \
    cargo --version

# =========================================
# APPLICATION
# =========================================

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY server.js ./

COPY execution ./execution

COPY geminiService.js ./

COPY terminalDockerRunner.js ./

# =========================================
# RENDER PORT
# =========================================

ENV PORT=10000
EXPOSE 10000

# =========================================
# START SERVER
# =========================================

CMD ["node", "server.js"]