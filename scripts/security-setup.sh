#!/bin/bash
# Zeus Terminal - Security Setup Script

set -e

echo "🔒 Zeus Terminal - Security Setup"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "⚠️  WARNING: Do not run this script as root!"
   echo "Run as the user that will operate Zeus Terminal."
   exit 1
fi

# Check current directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the herakles-terminal directory"
    exit 1
fi

echo "✅ Current directory: $(pwd)"
echo ""

# Step 1: Generate SESSION_SECRET
echo "📝 Step 1/5: Generating SESSION_SECRET..."
SESSION_SECRET=$(openssl rand -base64 32)
echo "✅ Generated: $SESSION_SECRET"
echo ""

# Step 2: Check .env file
echo "📝 Step 2/5: Checking environment configuration..."
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists"
    echo "Please manually update with these recommended settings:"
    echo ""
    echo "  NODE_ENV=production"
    echo "  ALLOW_DEV_AUTH_BYPASS=false"
    echo "  SESSION_SECRET=$SESSION_SECRET"
    echo "  IP_WHITELIST_ENABLED=false  # Set to true with ALLOWED_IPS if you have static IP"
    echo ""
else
    echo "📄 Creating .env from .env.example..."
    cp .env.example .env
    
    # Update .env with generated secret
    sed -i "s/CHANGE_THIS_TO_RANDOM_STRING_IN_PRODUCTION/$SESSION_SECRET/" .env
    sed -i "s/NODE_ENV=development/NODE_ENV=production/" .env
    
    echo "✅ Created .env with secure defaults"
    echo ""
fi

# Step 3: Check nginx configuration
echo "📝 Step 3/5: Checking nginx configuration..."
if [ -f "/etc/nginx/sites-enabled/zeus.herakles.dev" ]; then
    echo "✅ nginx configuration found"
    
    # Check for Authelia integration
    if sudo nginx -T 2>/dev/null | grep -q "authelia"; then
        echo "✅ Authelia integration detected"
    else
        echo "⚠️  WARNING: No Authelia configuration detected!"
        echo "   Zeus requires Authelia for authentication"
        echo "   See SECURITY.md for nginx configuration"
    fi
else
    echo "⚠️  WARNING: nginx configuration not found at /etc/nginx/sites-enabled/zeus.herakles.dev"
    echo "   See SECURITY.md for nginx configuration"
fi
echo ""

# Step 4: Check Cloudflare Tunnel
echo "📝 Step 4/5: Checking Cloudflare Tunnel..."
if pgrep -f "cloudflared.*8096" > /dev/null; then
    echo "✅ Cloudflare Tunnel running for Zeus Terminal"
elif pgrep -f "cloudflared" > /dev/null; then
    echo "⚠️  Cloudflare Tunnel running but not for port 8096"
    echo "   Consider adding Zeus to your tunnel configuration"
else
    echo "⚠️  WARNING: Cloudflare Tunnel not detected"
    echo "   Recommended for DDoS protection and zero-trust access"
    echo "   See SECURITY.md for Cloudflare Tunnel setup"
fi
echo ""

# Step 5: Security Checklist
echo "📝 Step 5/5: Security Checklist"
echo ""
echo "Please verify the following:"
echo ""
echo "  [ ] NODE_ENV=production in .env"
echo "  [ ] ALLOW_DEV_AUTH_BYPASS=false (or unset)"
echo "  [ ] SESSION_SECRET is randomly generated"
echo "  [ ] Authelia is configured and running"
echo "  [ ] Zeus listens only on 127.0.0.1:8096"
echo "  [ ] nginx reverse proxy with HTTPS is configured"
echo "  [ ] Cloudflare Tunnel or similar DDoS protection"
echo "  [ ] IP whitelist enabled (if you have static IP)"
echo "  [ ] 2FA enabled in Authelia"
echo "  [ ] Audit logging is enabled"
echo ""

# Show current IP
PUBLIC_IP=$(curl -s https://api.ipify.org || echo "unknown")
echo "ℹ️  Your current public IP: $PUBLIC_IP"
echo "   To enable IP whitelist:"
echo "   IP_WHITELIST_ENABLED=true"
echo "   ALLOWED_IPS=$PUBLIC_IP"
echo ""

echo "=================================="
echo "✅ Security setup complete!"
echo ""
echo "Next steps:"
echo "1. Review and edit .env file"
echo "2. Configure Authelia (if not already done)"
echo "3. Read SECURITY.md for detailed hardening guide"
echo "4. Restart Zeus Terminal: npm run dev"
echo ""
echo "📚 Documentation: ./SECURITY.md"
echo ""
