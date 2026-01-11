#!/bin/bash
# Zeus Terminal Development Environment Setup
# Sets up hot reload container, nginx, SSL, and visual validation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NGINX_CONF="/etc/nginx/sites-available/zeus.herakles.dev"

echo "🔱 Zeus Terminal Development Environment Setup"
echo "================================================"

# 1. Check prerequisites
echo ""
echo "1️⃣ Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found"
    exit 1
fi
echo "   ✅ Docker available"

if ! command -v nginx &> /dev/null; then
    echo "❌ Nginx not found"
    exit 1
fi
echo "   ✅ Nginx available"

if ! systemctl is-active --quiet nginx; then
    echo "   ⚠️ Nginx not running, starting..."
    sudo systemctl start nginx
fi

# 2. Install nginx config
echo ""
echo "2️⃣ Installing nginx configuration..."

if [ ! -f "$NGINX_CONF" ]; then
    sudo cp "$PROJECT_DIR/nginx/zeus.herakles.dev" "$NGINX_CONF"
    sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
    echo "   ✅ Nginx config installed"
else
    echo "   ⚠️ Nginx config already exists, updating..."
    sudo cp "$PROJECT_DIR/nginx/zeus.herakles.dev" "$NGINX_CONF"
fi

# Test nginx config
if sudo nginx -t 2>&1 | grep -q "successful"; then
    echo "   ✅ Nginx config valid"
    sudo systemctl reload nginx
    echo "   ✅ Nginx reloaded"
else
    echo "   ❌ Nginx config invalid:"
    sudo nginx -t
    exit 1
fi

# 3. Check/request SSL certificate
echo ""
echo "3️⃣ Checking SSL certificate..."

if [ -f "/etc/letsencrypt/live/herakles.dev/fullchain.pem" ]; then
    echo "   ✅ SSL certificate exists (wildcard)"
else
    echo "   ⚠️ SSL certificate not found"
    echo "   Run: sudo certbot certonly --nginx -d zeus.herakles.dev"
fi

# 4. Create Docker network if needed
echo ""
echo "4️⃣ Setting up Docker network..."

if ! docker network ls | grep -q "hercules-network"; then
    docker network create hercules-network
    echo "   ✅ Created hercules-network"
else
    echo "   ✅ hercules-network exists"
fi

# 5. Install visual validator dependencies
echo ""
echo "5️⃣ Setting up visual validator..."

VALIDATOR_DIR="$PROJECT_DIR/tools/visual-validator"
if [ -f "$VALIDATOR_DIR/requirements.txt" ]; then
    pip3 install -q -r "$VALIDATOR_DIR/requirements.txt" 2>/dev/null || \
    pip install -q -r "$VALIDATOR_DIR/requirements.txt" 2>/dev/null || \
    echo "   ⚠️ Could not install validator dependencies (may need venv)"
    echo "   ✅ Visual validator ready"
fi

# Make validator executable
chmod +x "$VALIDATOR_DIR/validator.py" 2>/dev/null || true

# 6. Start development container
echo ""
echo "6️⃣ Starting development container..."

cd "$PROJECT_DIR"

# Stop existing container if running
docker-compose -f docker-compose.dev.yml down 2>/dev/null || true

# Start with hot reload
docker-compose -f docker-compose.dev.yml up -d

echo "   ⏳ Waiting for container to be ready..."
sleep 10

# Check if container is running
if docker ps | grep -q "zeus-terminal-dev"; then
    echo "   ✅ Container running"
else
    echo "   ❌ Container failed to start"
    docker-compose -f docker-compose.dev.yml logs --tail=50
    exit 1
fi

# 7. Verify endpoints
echo ""
echo "7️⃣ Verifying endpoints..."

# Wait for server to be ready
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8096 2>/dev/null | grep -q "200\|301\|302"; then
        echo "   ✅ Local server responding (localhost:8096)"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo "   ⏳ Waiting for server... ($WAITED/$MAX_WAIT)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo "   ⚠️ Server not responding yet, check logs:"
    echo "   docker-compose -f docker-compose.dev.yml logs -f"
fi

# Check HTTPS endpoint
if curl -s -o /dev/null -w "%{http_code}" https://zeus.herakles.dev 2>/dev/null | grep -q "200\|301\|302\|401\|403"; then
    echo "   ✅ HTTPS endpoint responding (zeus.herakles.dev)"
else
    echo "   ⚠️ HTTPS endpoint not responding (may need SSL setup)"
fi

# 8. Summary
echo ""
echo "================================================"
echo "🔱 Setup Complete!"
echo "================================================"
echo ""
echo "📍 Endpoints:"
echo "   Local:  http://localhost:8096"
echo "   HTTPS:  https://zeus.herakles.dev"
echo "   Vite:   http://localhost:5173"
echo ""
echo "📸 Visual Validator:"
echo "   python3 $VALIDATOR_DIR/validator.py screenshot"
echo "   python3 $VALIDATOR_DIR/validator.py validate"
echo "   python3 $VALIDATOR_DIR/validator.py watch"
echo ""
echo "🔧 Commands:"
echo "   Logs:     docker-compose -f docker-compose.dev.yml logs -f"
echo "   Restart:  docker-compose -f docker-compose.dev.yml restart"
echo "   Stop:     docker-compose -f docker-compose.dev.yml down"
echo ""
