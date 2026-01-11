#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Herakles Terminal Setup ==="
echo ""

cd "$PROJECT_DIR"

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Error: Node.js 20+ is required (found v$NODE_VERSION)"
    exit 1
fi

echo "Installing dependencies..."
npm install

if [ ! -f ".env" ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    
    SECRET=$(openssl rand -base64 32 | tr -d '/+=')
    sed -i "s/your-secret-here-from-hercules-env/$SECRET/" .env
    
    echo "Generated new SESSION_SECRET"
fi

mkdir -p data

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start development server:"
echo "  npm run dev"
echo ""
echo "To build for production:"
echo "  npm run build"
echo ""
echo "To start production server:"
echo "  npm run start"
echo ""
