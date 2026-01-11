# Herakles Terminal - Security Guide

## 🔒 Quick Security Checklist

Before deploying Herakles Terminal to production, ensure you've completed these steps:

### Critical (Must Do)

- [ ] Set `NODE_ENV=production` in environment
- [ ] Set `ALLOW_DEV_AUTH_BYPASS=false` (or don't set it at all)
- [ ] Generate random `SESSION_SECRET` (use `openssl rand -base64 32`)
- [ ] Configure Authelia for SSO authentication
- [ ] Ensure Herakles Terminal only listens on `127.0.0.1:8096` (never 0.0.0.0)
- [ ] Deploy behind nginx reverse proxy with HTTPS
- [ ] Enable Cloudflare Tunnel or similar for DDoS protection

### Recommended

- [ ] Enable IP whitelist (`IP_WHITELIST_ENABLED=true` + `ALLOWED_IPS=`)
- [ ] Configure rate limiting (default 100 req/min is reasonable)
- [ ] Enable audit logging (enabled by default)
- [ ] Set up log monitoring/alerting
- [ ] Review and restrict shell commands if needed
- [ ] Enable 2FA in Authelia

### Optional (Defense in Depth)

- [ ] Run Herakles Terminal in Docker container with resource limits
- [ ] Use rbash (restricted bash) for terminal shell
- [ ] Implement command whitelisting
- [ ] Set up fail2ban for brute force protection
- [ ] Enable Prometheus/Loki for observability
- [ ] Regular security audits of audit logs

---

## 🛡️ Security Features (Built-in)

### 1. Authentication
- **Authelia SSO** integration via reverse proxy headers
- Username/email validation with regex
- Trusted proxy verification (only accepts from 127.0.0.1)
- Development bypass **disabled by default** in production

### 2. Transport Security
- HTTPS/WSS encryption via nginx reverse proxy
- Secure WebSocket connections only
- CORS restricted to allowed origins
- Security headers (CSP, HSTS, X-Frame-Options)

### 3. Rate Limiting
- HTTP requests: 100/minute per session (configurable)
- WebSocket connections tracked per IP
- Automatic blocking of excessive requests

### 4. Input Validation
- Email regex validation
- Username whitelist (alphanumeric + _ -)
- WebSocket message size limits (1MB default)
- CSRF token protection on API routes

### 5. Audit Logging
- All commands logged to SQLite
- Full user activity trail
- 90-day retention by default
- Immutable audit log

### 6. Session Management
- Session persistence in SQLite
- Configurable timeout (24 hours default)
- Multi-device coordination with soft-locking
- Automatic session cleanup

---

## ⚠️ Known Risks & Mitigations

### Risk 1: Direct Shell Access
**Risk:** Authenticated users have full shell access to server.

**Mitigations:**
- Run Herakles Terminal under dedicated user account (not root)
- Use rbash (restricted bash) if needed
- Implement command whitelisting (requires code change)
- Monitor audit logs for suspicious commands
- Consider containerization per session

### Risk 2: WebSocket Session Hijacking
**Risk:** If attacker steals auth headers, they can connect.

**Mitigations:**
- Use Authelia with 2FA enabled
- Enable IP whitelist to restrict access
- Monitor for multiple connections from same user
- Short session timeouts (consider 1-4 hours)
- Regular session rotation

### Risk 3: XSS in Web UI
**Risk:** Malicious script injection could steal session.

**Mitigations:**
- Content Security Policy headers (enabled)
- Strict input sanitization in terminal output
- Regular dependency updates
- Code reviews for client-side code

### Risk 4: Denial of Service
**Risk:** Attacker floods with requests/connections.

**Mitigations:**
- Rate limiting (enabled by default)
- Cloudflare Tunnel for DDoS protection
- WebSocket connection limits
- Message size limits
- Resource monitoring/alerting

### Risk 5: Lateral Movement
**Risk:** Compromised Zeus could access other services.

**Mitigations:**
- Run in isolated network segment
- Firewall rules (only allow nginx → Zeus)
- Principle of least privilege for system user
- Network segmentation
- Container isolation (optional)

---

## 🔐 Environment Configuration

### Secure Defaults
```bash
# Production environment
NODE_ENV=production
ALLOW_DEV_AUTH_BYPASS=false  # CRITICAL!
SESSION_SECRET=$(openssl rand -base64 32)

# IP Whitelist (if you have static IP)
IP_WHITELIST_ENABLED=true
ALLOWED_IPS=YOUR.PUBLIC.IP.ADDRESS

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

### Insecure Configuration (DO NOT USE)
```bash
# ❌ NEVER DO THIS IN PRODUCTION
NODE_ENV=development
ALLOW_DEV_AUTH_BYPASS=true  # Allows anyone to connect!
SESSION_SECRET=insecure
IP_WHITELIST_ENABLED=false
```

---

## 🚨 Incident Response

### If You Suspect Compromise

1. **Immediate Actions:**
   ```bash
   # Stop Herakles Terminal
   pkill -f "tsx.*herakles"
   
   # Check active sessions
   sqlite3 data/herakles.db "SELECT * FROM sessions WHERE active = 1;"
   
   # Review audit logs
   sqlite3 data/herakles.db "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100;"
   ```

2. **Investigation:**
   - Check audit logs for unusual commands
   - Review session creation times/IPs
   - Check for unauthorized file access
   - Look for privilege escalation attempts

3. **Recovery:**
   - Rotate all secrets (SESSION_SECRET, API keys)
   - Force logout all sessions (delete sessions table)
   - Update Zeus to latest version
   - Review and patch vulnerabilities
   - Re-enable with enhanced monitoring

### Monitoring Alerts to Set Up

```bash
# Unusual command patterns
sqlite3 data/herakles.db "SELECT * FROM audit_logs WHERE command LIKE '%sudo%' OR command LIKE '%rm -rf%';"

# Multiple failed auth attempts
grep "Rejected:" /var/log/herakles/app.log | tail -20

# Session from unexpected IP
sqlite3 data/herakles.db "SELECT * FROM sessions WHERE client_ip NOT IN ('YOUR.EXPECTED.IP');"
```

---

## 📋 Security Comparison

| Feature | Herakles Terminal | Traditional SSH | Cloud IDEs |
|---------|---------------|-----------------|------------|
| Authentication | Authelia SSO | SSH Keys + Password | OAuth/SAML |
| Transport | HTTPS/WSS | SSH Protocol | HTTPS |
| Audit Logging | Built-in (SQLite) | Manual (syslog) | Platform-dependent |
| 2FA Support | Yes (via Authelia) | Yes (SSH + OTP) | Yes |
| Rate Limiting | Built-in | fail2ban | Platform-dependent |
| IP Whitelist | Configurable | firewall rules | Platform-dependent |
| Session Persistence | SQLite | tmux/screen | Platform-dependent |
| Command Filtering | Manual (code change) | rbash | Platform-dependent |

---

## 🔧 Hardening Checklist

### Nginx Configuration
```nginx
# /etc/nginx/sites-enabled/terminal.herakles.dev

server {
    listen 443 ssl http2;
    server_name terminal.herakles.dev;

    # SSL/TLS Configuration
    ssl_certificate /etc/letsencrypt/live/terminal.herakles.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/terminal.herakles.dev/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Authelia SSO
    include /etc/nginx/snippets/authelia-location.conf;

    location / {
        include /etc/nginx/snippets/authelia-authrequest.conf;
        
        proxy_pass http://127.0.0.1:8096;
        proxy_http_version 1.1;
        
        # WebSocket Support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Security Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Clear any upstream auth headers (prevent spoofing)
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Email "";
        proxy_set_header Remote-Groups "";
    }
}
```

### Authelia Configuration
```yaml
# /etc/authelia/configuration.yml

authentication_backend:
  file:
    password:
      algorithm: argon2id
      iterations: 3
      salt_length: 16
      parallelism: 4
      memory: 64

access_control:
  default_policy: deny
  rules:
    - domain: terminal.herakles.dev
      policy: two_factor  # Require 2FA!
      subject:
        - "group:admins"
        - "group:developers"

session:
  name: authelia_session
  expiration: 3600  # 1 hour
  inactivity: 300   # 5 minutes
  remember_me_duration: 1M

totp:
  issuer: herakles.dev
  period: 30
  skew: 1
```

### Cloudflare Tunnel
```yaml
# /root/.cloudflared/config.yml

tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/credentials.json

ingress:
  - hostname: terminal.herakles.dev
    service: http://localhost:443
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s
  - service: http_status:404
```

---

## 📞 Security Contact

For security issues, please contact:
- Email: security@herakles.dev (if configured)
- Create private issue in repository
- DO NOT disclose vulnerabilities publicly

---

## 📚 Additional Resources

- [OWASP WebSocket Security](https://owasp.org/www-community/vulnerabilities/WebSocket_Security)
- [Authelia Documentation](https://www.authelia.com/)
- [Cloudflare Tunnel Best Practices](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [nginx Security Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Security_Response_Headers_Cheat_Sheet.html)

---

**Last Updated:** 2025-12-19  
**Security Level:** Medium Risk (with hardening: Acceptable for Personal Use)

---

## 📋 Security Review Status

**Last Full Review:** 2024-12-18 (see `docs/archive/security/CODE_REVIEW_REPORT.md`)

### Issues Status Summary

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| ANSI sequence splitting | HIGH | **RESOLVED** | Chunking removed in Sprint 3 |
| WebSocket race condition | HIGH | **RESOLVED** | Architecture refactored in Sprint 4 |
| DoS via large messages | MEDIUM | **OPEN** | Pre-parse size check needed |
| Error message disclosure | MEDIUM | **OPEN** | Sanitization needed |
| Terminal output sanitization | MEDIUM | **LOW PRIORITY** | XTerm handles safely |
| Missing React cleanup | MEDIUM | **RESOLVED** | TerminalCore handles cleanup |
| Backpressure handling | MEDIUM | **OPEN** | Needed for slow clients |

**Priority 1 Issues (from Dec 18 review):** 2/3 RESOLVED  
**Current Security Score:** 8/10 (Production-ready for personal use)
