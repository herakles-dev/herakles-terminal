#!/usr/bin/env python3
"""
Zeus Terminal Visual Validator

Integrates with Claude Autonomous Scraper (Hydra) framework to provide
screenshot-based validation during spec-driven development.

Usage:
    python3 validator.py screenshot <url> [--output screenshot.png]
    python3 validator.py validate <url> --checks terminal,quickbar,connection
    python3 validator.py watch <url> --interval 5
"""

import sys
import os
import json
import argparse
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

# Add Hydra framework to path
sys.path.insert(0, '/home/hercules/Claude_Autonomous_Scraper')

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

try:
    from framework.visual_feedback import VisualFeedback
    from framework.session import BrowserSession
    HYDRA_AVAILABLE = True
except ImportError:
    HYDRA_AVAILABLE = False
    print("Warning: Hydra framework not available, using standalone mode")


class ZeusVisualValidator:
    """Visual validation for Zeus Terminal UI components."""
    
    VALIDATION_CHECKS = {
        'terminal': {
            'selector': '.xterm-screen, [data-testid="terminal"]',
            'description': 'Terminal xterm.js container',
            'required': True
        },
        'quickbar': {
            'selector': '[data-testid="quick-key-bar"], .quick-key-bar',
            'description': 'Quick key bar component',
            'required': False
        },
        'connection': {
            'selector': '[data-testid="connection-status"], .connection-status',
            'description': 'Connection status indicator',
            'required': True
        },
        'sidepanel': {
            'selector': '[data-testid="side-panel"], .side-panel',
            'description': 'Side panel (Automations/Command Builder)',
            'required': False
        },
        'splitview': {
            'selector': '[data-testid="split-view"], .split-view',
            'description': 'Split view container',
            'required': False
        },
        'toast': {
            'selector': '[data-testid="toast"], .toast-container',
            'description': 'Toast notification container',
            'required': False
        },
        'session_picker': {
            'selector': '[data-testid="session-picker"], .session-picker',
            'description': 'Session picker modal',
            'required': False
        }
    }
    
    def __init__(
        self,
        base_url: str = "https://zeus.herakles.dev",
        output_dir: str = "/home/hercules/herakles-terminal/tools/visual-validator/screenshots",
        headless: bool = True,
        auth_user: Optional[str] = None,
        auth_password: Optional[str] = None
    ):
        self.base_url = base_url
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.headless = headless
        self.driver = None
        self.authenticated = False
        
        self.auth_user = auth_user or os.environ.get('ZEUS_AUTOMATION_USER')
        self.auth_password = auth_password or os.environ.get('ZEUS_AUTOMATION_PASSWORD')
        
        if HYDRA_AVAILABLE:
            self.visual = VisualFeedback("zeus-terminal", str(self.output_dir))
        else:
            self.visual = None
    
    def _create_driver(self) -> webdriver.Chrome:
        """Create Chrome WebDriver with appropriate options."""
        options = Options()
        
        if self.headless:
            options.add_argument('--headless=new')
        
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--disable-web-security')
        options.add_argument('--allow-running-insecure-content')
        
        # Mobile viewport for testing
        mobile_emulation = {
            "deviceMetrics": {"width": 375, "height": 812, "pixelRatio": 3.0},
            "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15"
        }
        # Uncomment for mobile testing:
        # options.add_experimental_option("mobileEmulation", mobile_emulation)
        
        return webdriver.Chrome(options=options)
    
    def start(self):
        """Start browser session."""
        self.driver = self._create_driver()
        return self
    
    def login_authelia(self, timeout: int = 15) -> bool:
        """
        Authenticate with Authelia SSO.
        
        Credentials are loaded from:
        1. Constructor parameters (auth_user, auth_password)
        2. Environment variables (ZEUS_AUTOMATION_USER, ZEUS_AUTOMATION_PASSWORD)
        3. Secrets file (/home/hercules/.secrets/hercules.env)
        
        Returns:
            True if authentication successful
        """
        if self.authenticated:
            return True
        
        if not self.auth_user or not self.auth_password:
            secrets_path = Path('/home/hercules/.secrets/hercules.env')
            if secrets_path.exists():
                with open(secrets_path) as f:
                    for line in f:
                        if line.startswith('ZEUS_AUTOMATION_USER='):
                            self.auth_user = line.split('=', 1)[1].strip()
                        elif line.startswith('ZEUS_AUTOMATION_PASSWORD='):
                            self.auth_password = line.split('=', 1)[1].strip()
        
        if not self.auth_user or not self.auth_password:
            print("Error: No Authelia credentials available")
            print("Set ZEUS_AUTOMATION_USER and ZEUS_AUTOMATION_PASSWORD environment variables")
            return False
        
        if not self.driver:
            self.start()
        
        self.driver.get(self.base_url)
        time.sleep(2)
        
        current_url = self.driver.current_url
        if 'auth.herakles.dev' not in current_url and 'authelia' not in current_url.lower():
            print("Already authenticated or no SSO redirect")
            self.authenticated = True
            return True
        
        print(f"Authelia login page detected: {current_url}")
        
        try:
            username_field = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '.form-input[type="text"], input[name="username"], input#username'))
            )
            username_field.clear()
            username_field.send_keys(self.auth_user)
            
            password_field = self.driver.find_element(By.CSS_SELECTOR, '.form-input[type="password"], input[name="password"], input#password')
            password_field.clear()
            password_field.send_keys(self.auth_password)
            
            submit_btn = self.driver.find_element(By.CSS_SELECTOR, '.submit-btn, button[type="submit"], input[type="submit"]')
            submit_btn.click()
            
            time.sleep(3)
            
            current_url = self.driver.current_url
            parsed = urlparse(current_url)
            target_parsed = urlparse(self.base_url)
            
            if parsed.netloc == target_parsed.netloc or 'auth.herakles.dev' not in current_url:
                print(f"Authentication successful, now at: {current_url}")
                self.authenticated = True
                return True
            else:
                print(f"Authentication may have failed, still at: {current_url}")
                self.screenshot(name="auth_failed")
                return False
                
        except TimeoutException:
            print("Timeout waiting for Authelia login form")
            self.screenshot(name="auth_timeout")
            return False
        except Exception as e:
            print(f"Authentication error: {e}")
            self.screenshot(name="auth_error")
            return False
    
    def stop(self):
        """Stop browser session."""
        if self.driver:
            self.driver.quit()
            self.driver = None
    
    def __enter__(self):
        return self.start()
    
    def __exit__(self, *args):
        self.stop()
    
    def screenshot(
        self,
        url: Optional[str] = None,
        name: str = "screenshot",
        wait_for: Optional[str] = None,
        timeout: int = 10
    ) -> str:
        """
        Take a screenshot of the page.
        
        Args:
            url: URL to navigate to (uses base_url if None)
            name: Name for the screenshot file
            wait_for: CSS selector to wait for before screenshot
            timeout: Timeout in seconds
        
        Returns:
            Path to saved screenshot
        """
        if not self.driver:
            self.start()
        
        target_url = url or self.base_url
        
        if not self.authenticated:
            self.login_authelia()
        
        self.driver.get(target_url)
        
        if wait_for:
            try:
                WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, wait_for))
                )
            except TimeoutException:
                print(f"Warning: Timeout waiting for {wait_for}")
        else:
            time.sleep(2)  # Default wait for page load
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{name}_{timestamp}.png"
        filepath = self.output_dir / filename
        
        self.driver.save_screenshot(str(filepath))
        print(f"Screenshot saved: {filepath}")
        
        return str(filepath)
    
    def validate(
        self,
        url: Optional[str] = None,
        checks: Optional[List[str]] = None,
        timeout: int = 10
    ) -> Dict:
        """
        Validate UI components are present and visible.
        
        Args:
            url: URL to validate
            checks: List of check names (defaults to all)
            timeout: Timeout for each check
        
        Returns:
            Validation results dictionary
        """
        if not self.driver:
            self.start()
        
        target_url = url or self.base_url
        
        if not self.authenticated:
            self.login_authelia()
        
        self.driver.get(target_url)
        time.sleep(3)  # Wait for React to render
        
        checks = checks or list(self.VALIDATION_CHECKS.keys())
        
        results = {
            'url': target_url,
            'timestamp': datetime.now().isoformat(),
            'checks': {},
            'passed': 0,
            'failed': 0,
            'warnings': 0,
            'overall': 'unknown'
        }
        
        for check_name in checks:
            if check_name not in self.VALIDATION_CHECKS:
                print(f"Warning: Unknown check '{check_name}'")
                continue
            
            check = self.VALIDATION_CHECKS[check_name]
            
            try:
                element = WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, check['selector']))
                )
                
                is_visible = element.is_displayed()
                
                results['checks'][check_name] = {
                    'status': 'pass' if is_visible else 'warning',
                    'description': check['description'],
                    'visible': is_visible,
                    'found': True
                }
                
                if is_visible:
                    results['passed'] += 1
                else:
                    results['warnings'] += 1
                    
            except (TimeoutException, NoSuchElementException):
                status = 'fail' if check['required'] else 'warning'
                results['checks'][check_name] = {
                    'status': status,
                    'description': check['description'],
                    'visible': False,
                    'found': False,
                    'required': check['required']
                }
                
                if check['required']:
                    results['failed'] += 1
                else:
                    results['warnings'] += 1
        
        # Determine overall status
        if results['failed'] > 0:
            results['overall'] = 'fail'
        elif results['warnings'] > 0:
            results['overall'] = 'warning'
        else:
            results['overall'] = 'pass'
        
        # Take screenshot with results
        screenshot_path = self.screenshot(name=f"validation_{results['overall']}")
        results['screenshot'] = screenshot_path
        
        # Save results to JSON
        results_path = self.output_dir / f"validation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_path, 'w') as f:
            json.dump(results, f, indent=2)
        
        return results
    
    def watch(
        self,
        url: Optional[str] = None,
        interval: int = 5,
        checks: Optional[List[str]] = None,
        max_iterations: int = 100
    ):
        """
        Watch page and validate periodically (for hot reload testing).
        
        Args:
            url: URL to watch
            interval: Seconds between checks
            checks: Validation checks to run
            max_iterations: Maximum number of iterations
        """
        if not self.driver:
            self.start()
        
        target_url = url or self.base_url
        print(f"Watching {target_url} every {interval}s...")
        print("Press Ctrl+C to stop")
        
        iteration = 0
        last_status = None
        
        try:
            while iteration < max_iterations:
                iteration += 1
                
                results = self.validate(url=target_url, checks=checks)
                current_status = results['overall']
                
                status_icon = {
                    'pass': '✅',
                    'warning': '⚠️',
                    'fail': '❌'
                }.get(current_status, '❓')
                
                if current_status != last_status:
                    print(f"\n{status_icon} [{datetime.now().strftime('%H:%M:%S')}] Status changed: {current_status}")
                    print(f"   Passed: {results['passed']}, Failed: {results['failed']}, Warnings: {results['warnings']}")
                    last_status = current_status
                else:
                    print(f".", end='', flush=True)
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            print("\nWatch stopped")
    
    def get_page_state(self, url: Optional[str] = None) -> Dict:
        """
        Get comprehensive page state for debugging.
        
        Returns:
            Dictionary with page info, console logs, network errors
        """
        if not self.driver:
            self.start()
        
        target_url = url or self.base_url
        
        if not self.authenticated:
            self.login_authelia()
        
        self.driver.get(target_url)
        time.sleep(3)
        
        state = {
            'url': self.driver.current_url,
            'title': self.driver.title,
            'timestamp': datetime.now().isoformat(),
            'viewport': self.driver.get_window_size(),
            'scroll_position': self.driver.execute_script(
                "return {x: window.scrollX, y: window.scrollY}"
            ),
            'console_logs': [],
            'errors': []
        }
        
        # Get console logs
        try:
            logs = self.driver.get_log('browser')
            state['console_logs'] = [
                {'level': log['level'], 'message': log['message']}
                for log in logs
            ]
            state['errors'] = [
                log for log in state['console_logs']
                if log['level'] in ['SEVERE', 'ERROR']
            ]
        except:
            pass
        
        return state


def main():
    parser = argparse.ArgumentParser(description="Zeus Terminal Visual Validator")
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Screenshot command
    screenshot_parser = subparsers.add_parser('screenshot', help='Take a screenshot')
    screenshot_parser.add_argument('url', nargs='?', default='https://zeus.herakles.dev')
    screenshot_parser.add_argument('--output', '-o', default='screenshot')
    screenshot_parser.add_argument('--wait-for', '-w', help='CSS selector to wait for')
    screenshot_parser.add_argument('--no-headless', action='store_true')
    
    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate UI components')
    validate_parser.add_argument('url', nargs='?', default='https://zeus.herakles.dev')
    validate_parser.add_argument('--checks', '-c', help='Comma-separated list of checks')
    validate_parser.add_argument('--timeout', '-t', type=int, default=10)
    validate_parser.add_argument('--no-headless', action='store_true')
    
    # Watch command
    watch_parser = subparsers.add_parser('watch', help='Watch and validate continuously')
    watch_parser.add_argument('url', nargs='?', default='https://zeus.herakles.dev')
    watch_parser.add_argument('--interval', '-i', type=int, default=5)
    watch_parser.add_argument('--checks', '-c', help='Comma-separated list of checks')
    watch_parser.add_argument('--no-headless', action='store_true')
    
    # State command
    state_parser = subparsers.add_parser('state', help='Get page state')
    state_parser.add_argument('url', nargs='?', default='https://zeus.herakles.dev')
    state_parser.add_argument('--no-headless', action='store_true')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
    
    headless = not getattr(args, 'no_headless', False)
    
    with ZeusVisualValidator(
        headless=headless,
        auth_user=os.environ.get('ZEUS_AUTOMATION_USER'),
        auth_password=os.environ.get('ZEUS_AUTOMATION_PASSWORD')
    ) as validator:
        if args.command == 'screenshot':
            validator.screenshot(
                url=args.url,
                name=args.output,
                wait_for=getattr(args, 'wait_for', None)
            )
            
        elif args.command == 'validate':
            checks = args.checks.split(',') if args.checks else None
            results = validator.validate(
                url=args.url,
                checks=checks,
                timeout=args.timeout
            )
            
            print(f"\n{'='*50}")
            print(f"Validation Results: {results['overall'].upper()}")
            print(f"{'='*50}")
            
            for name, check in results['checks'].items():
                icon = {'pass': '✅', 'warning': '⚠️', 'fail': '❌'}[check['status']]
                print(f"{icon} {name}: {check['description']}")
            
            print(f"\nScreenshot: {results['screenshot']}")
            
            return 0 if results['overall'] != 'fail' else 1
            
        elif args.command == 'watch':
            checks = args.checks.split(',') if args.checks else None
            validator.watch(
                url=args.url,
                interval=args.interval,
                checks=checks
            )
            
        elif args.command == 'state':
            state = validator.get_page_state(url=args.url)
            print(json.dumps(state, indent=2))
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
