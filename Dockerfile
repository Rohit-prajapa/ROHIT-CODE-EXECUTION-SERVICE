FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install all required compilers and runtimes
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
    && rm -rf /var/lib/apt/lists/*

# Verify installed runtimes
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

# Install backend dependencies
COPY package*.json ./

RUN npm install --omit=dev

# Copy backend server
COPY server.js ./

# Copy execution modules if they are required by server.js
COPY execution ./execution

# Copy additional backend files if present
COPY geminiService.js ./
COPY terminalDockerRunner.js ./

# Render provides PORT automatically
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]