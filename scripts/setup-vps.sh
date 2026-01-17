#!/bin/bash
#
# setup-vps.sh - Initial VPS setup for PickMyClass
#
# Run this script ONCE on a new VPS to install all dependencies:
# - Bun (JavaScript runtime)
# - PM2 (process manager)
# - Caddy (reverse proxy with automatic HTTPS)
#
# Target: Oracle Cloud ARM64 (Ubuntu 22.04)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/your-repo/scripts/setup-vps.sh | bash
#   # or
#   ./scripts/setup-vps.sh
#
# After running this script:
# 1. Clone the repository
# 2. Copy .env.example to .env and configure
# 3. Run ./scripts/deploy.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Header
echo ""
echo "========================================"
echo "  PickMyClass VPS Setup"
echo "  Target: Ubuntu 22.04 ARM64"
echo "========================================"
echo ""

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
    log_warn "Script not running as root. Some commands will use sudo."
    SUDO="sudo"
else
    SUDO=""
fi

# Step 1: System updates
log_info "Step 1/6: Updating system packages..."

$SUDO apt-get update
$SUDO apt-get upgrade -y

log_success "System updated"

# Step 2: Install essential packages
log_info "Step 2/6: Installing essential packages..."

$SUDO apt-get install -y \
    curl \
    wget \
    git \
    unzip \
    build-essential

log_success "Essential packages installed"

# Step 3: Install Bun
log_info "Step 3/6: Installing Bun..."

if command -v bun &> /dev/null; then
    log_warn "Bun already installed: $(bun --version)"
else
    curl -fsSL https://bun.sh/install | bash

    # Add bun to current session PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    # Add to shell profile for persistence
    if [[ -f "$HOME/.bashrc" ]]; then
        echo '' >> "$HOME/.bashrc"
        echo '# Bun' >> "$HOME/.bashrc"
        echo 'export BUN_INSTALL="$HOME/.bun"' >> "$HOME/.bashrc"
        echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> "$HOME/.bashrc"
    fi

    log_success "Bun installed: $(bun --version)"
fi

# Step 4: Install PM2
log_info "Step 4/6: Installing PM2..."

if command -v pm2 &> /dev/null; then
    log_warn "PM2 already installed: $(pm2 --version)"
else
    # Install PM2 globally using bun
    bun install -g pm2

    # Setup PM2 startup script for system reboots
    # This generates the command to run as root
    log_info "Setting up PM2 startup script..."
    pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | $SUDO bash

    log_success "PM2 installed: $(pm2 --version)"
fi

# Step 5: Install Caddy
log_info "Step 5/6: Installing Caddy..."

if command -v caddy &> /dev/null; then
    log_warn "Caddy already installed: $(caddy version)"
else
    # Install Caddy using official repository
    $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https

    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list

    $SUDO apt-get update
    $SUDO apt-get install -y caddy

    log_success "Caddy installed: $(caddy version)"
fi

# Step 6: Create application directories
log_info "Step 6/6: Creating application directories..."

APP_DIR="$HOME/pickmyclass"
LOG_DIR="$APP_DIR/logs"

mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"

log_success "Directories created: $APP_DIR"

# Summary
echo ""
echo "========================================"
echo "  Setup Complete"
echo "========================================"
echo ""
log_info "Installed versions:"
echo "  - Bun: $(bun --version 2>/dev/null || echo 'restart shell to use')"
echo "  - PM2: $(pm2 --version 2>/dev/null || echo 'restart shell to use')"
echo "  - Caddy: $(caddy version 2>/dev/null || echo 'installed')"
echo ""
log_info "Next steps:"
echo ""
echo "  1. Clone the repository:"
echo "     cd $APP_DIR"
echo "     git clone https://github.com/your-org/pickmyclass.git ."
echo ""
echo "  2. Configure environment:"
echo "     cp .env.example .env"
echo "     nano .env  # Edit with your values"
echo ""
echo "  3. Configure Caddy (update domain):"
echo "     sudo cp Caddyfile /etc/caddy/Caddyfile"
echo "     sudo systemctl reload caddy"
echo ""
echo "  4. Deploy the application:"
echo "     ./scripts/deploy.sh"
echo ""
echo "  5. Verify health:"
echo "     curl http://localhost:3000/api/monitoring/health"
echo ""
log_warn "Remember to:"
echo "  - Set up firewall rules (ports 80, 443)"
echo "  - Configure DNS to point to this server"
echo "  - Set up Upstash Redis or configure REDIS_URL"
echo ""
