#!/bin/bash
#
# deploy.sh - Deployment script for PickMyClass VPS
#
# Run this script on each deployment to:
# 1. Pull latest code from git
# 2. Install dependencies with bun
# 3. Build Next.js application
# 4. Reload PM2 processes
#
# Usage:
#   ./scripts/deploy.sh
#
# Prerequisites:
#   - bun installed (run setup-vps.sh first)
#   - PM2 installed globally
#   - Application already set up with ecosystem.config.js
#
# Environment:
#   - DEPLOY_BRANCH: Git branch to deploy (default: main)
#

set -euo pipefail

# Configuration
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

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
echo "  PickMyClass Deployment"
echo "  Branch: $DEPLOY_BRANCH"
echo "========================================"
echo ""

cd "$PROJECT_DIR"

# Step 1: Pull latest code
log_info "Step 1/4: Pulling latest code from $DEPLOY_BRANCH..."

git fetch origin
git checkout "$DEPLOY_BRANCH"
git pull origin "$DEPLOY_BRANCH"

log_success "Code updated to latest $DEPLOY_BRANCH"

# Step 2: Install dependencies
log_info "Step 2/4: Installing dependencies..."

bun install --frozen-lockfile

log_success "Dependencies installed"

# Step 3: Build Next.js
log_info "Step 3/4: Building Next.js application..."

bun run build

log_success "Build completed"

# Step 4: Reload PM2
log_info "Step 4/4: Reloading PM2 processes..."

if pm2 describe pickmyclass > /dev/null 2>&1; then
    # Application already running, reload it
    pm2 reload ecosystem.config.js --update-env
    log_success "PM2 processes reloaded"
else
    # First deployment, start the application
    log_warn "Application not running, starting fresh..."
    pm2 start ecosystem.config.js
    log_success "PM2 application started"
fi

# Save PM2 process list for resurrection on reboot
pm2 save

# Summary
echo ""
echo "========================================"
echo "  Deployment Complete"
echo "========================================"
echo ""
log_info "Deployment status:"
pm2 status

echo ""
log_info "Application logs: pm2 logs pickmyclass"
log_info "Health check: curl http://localhost:3000/api/monitoring/health"
echo ""
