#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Herakles Terminal Deployment ==="
echo ""

cd "$PROJECT_DIR"

source /home/hercules/.secrets/hercules.env

if [ -z "$HERAKLES_TERMINAL_SECRET" ]; then
    echo "Generating HERAKLES_TERMINAL_SECRET..."
    HERAKLES_TERMINAL_SECRET=$(openssl rand -base64 32 | tr -d '/+=')
    echo "HERAKLES_TERMINAL_SECRET=$HERAKLES_TERMINAL_SECRET" >> /home/hercules/.secrets/hercules.env
    export HERAKLES_TERMINAL_SECRET
fi

echo "Building Docker image..."
docker-compose build

echo "Stopping existing container (if any)..."
docker-compose down --remove-orphans || true

echo "Starting container..."
docker-compose up -d

echo "Waiting for health check..."
sleep 5

for i in {1..10}; do
    if curl -sf http://localhost:8096/api/health > /dev/null; then
        echo "Health check passed!"
        break
    fi
    echo "Waiting for service to start... ($i/10)"
    sleep 2
done

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Service running at: http://localhost:8096"
echo "Subdomain: zeus.herakles.dev"
echo ""
echo "To view logs:"
echo "  docker logs -f zeus-terminal"
echo ""
