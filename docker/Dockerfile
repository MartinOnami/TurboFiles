# Multi-stage image for building and CI of TurboFiles.
# Builds the Linux Tauri bundle; not intended as a runtime container (TurboFiles is
# a desktop app). For local protocol servers see docker-compose.test.yml.

FROM rust:1.79-bookworm AS base

# System dependencies required by Tauri v2 on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    pkg-config \
    build-essential \
    curl \
    file \
    && rm -rf /var/lib/apt/lists/*

# Node 20 (for the frontend build).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies first.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build frontend + Tauri bundle.
RUN npm run build \
    && npm run tauri build -- --bundles deb appimage

# The artifacts land in src-tauri/target/release/bundle/.
CMD ["bash", "-lc", "ls -lR src-tauri/target/release/bundle/"]
