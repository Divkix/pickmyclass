# ===================================
# Stage 1: Builder
# ===================================
FROM oven/bun:1.3-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install ALL dependencies (including devDependencies for building)
RUN bun install --frozen-lockfile

# Copy source code and config
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript to JavaScript
RUN bun run build

# ===================================
# Stage 2: Runtime
# ===================================
FROM oven/bun:1.3-slim

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install ONLY production dependencies
RUN bun install --frozen-lockfile --production

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN useradd -m -u 1001 scraper && \
    chown -R scraper:scraper /app

USER scraper

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the server
CMD ["bun", "dist/index.js"]
