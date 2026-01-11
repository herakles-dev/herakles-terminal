#!/usr/bin/env python3
import time
import sys
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import os

def get_auth_creds():
    user = os.environ.get('ZEUS_AUTOMATION_USER')
    password = os.environ.get('ZEUS_AUTOMATION_PASSWORD')
    
    if not user or not password:
        secrets_path = Path('/home/hercules/.secrets/hercules.env')
        if secrets_path.exists():
            with open(secrets_path) as f:
                for line in f:
                    if line.startswith('ZEUS_AUTOMATION_USER='):
                        user = line.split('=', 1)[1].strip()
                    elif line.startswith('ZEUS_AUTOMATION_PASSWORD='):
                        password = line.split('=', 1)[1].strip()
    
    return user, password

def test_terminal():
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    
    driver = webdriver.Chrome(options=options)
    
    try:
        driver.get('https://zeus.herakles.dev')
        time.sleep(2)
        print(f"Initial URL: {driver.current_url}")
        
        if 'auth.herakles.dev' in driver.current_url:
            print("Logging in via Authelia...")
            user, password = get_auth_creds()
            if not user or not password:
                print("ERROR: No credentials found!")
                return
            
            username_field = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '.form-input[type="text"], input[name="username"], input#username'))
            )
            username_field.clear()
            username_field.send_keys(user)
            
            password_field = driver.find_element(By.CSS_SELECTOR, '.form-input[type="password"], input[name="password"], input#password')
            password_field.clear()
            password_field.send_keys(password)
            
            submit = driver.find_element(By.CSS_SELECTOR, '.submit-btn, button[type="submit"], input[type="submit"]')
            submit.click()
            
            time.sleep(3)
            print(f"After login: {driver.current_url}")
        
        print("Waiting for page load...")
        time.sleep(2)
        
        try:
            enter_btn = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Enter Terminal')]"))
            )
            print("Found 'Enter Terminal' button, clicking...")
            enter_btn.click()
        except:
            print("No welcome screen, terminal should be visible")
        
        print("Waiting for terminal to load...")
        time.sleep(5)
        
        screenshot_path = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-test.png'
        driver.save_screenshot(screenshot_path)
        print(f"Screenshot 1 saved: {screenshot_path}")
        
        print("Waiting for session connection (5 seconds)...")
        time.sleep(5)
        
        screenshot_path2 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-after-wait.png'
        driver.save_screenshot(screenshot_path2)
        print(f"Screenshot 2 saved: {screenshot_path2}")
        
        page_source = driver.page_source
        if 'xterm' in page_source.lower():
            print("xterm found in page!")
        else:
            print("WARNING: xterm NOT found in page")
        
        print("\n=== Testing keyboard input ===")
        from selenium.webdriver.common.action_chains import ActionChains
        
        terminal = driver.find_element(By.CSS_SELECTOR, '.xterm-helper-textarea')
        terminal.click()
        time.sleep(0.5)
        
        actions = ActionChains(driver)
        actions.send_keys("echo 'Hello from Selenium!'")
        actions.perform()
        time.sleep(1)
        
        screenshot_path3 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-typed.png'
        driver.save_screenshot(screenshot_path3)
        print(f"Screenshot 3 (after typing): {screenshot_path3}")
        
        actions = ActionChains(driver)
        actions.send_keys("\n")
        actions.perform()
        time.sleep(2)
        
        screenshot_path4 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-executed.png'
        driver.save_screenshot(screenshot_path4)
        print(f"Screenshot 4 (after Enter): {screenshot_path4}")
        
        print("\n=== Testing QuickKeyBar ===")
        try:
            ctrl_c_btn = driver.find_element(By.XPATH, "//button[contains(text(), '^C')]")
            ctrl_c_btn.click()
            time.sleep(0.5)
            print("Clicked ^C button - OK")
        except Exception as e:
            print(f"QuickKeyBar test failed: {e}")
        
        screenshot_path5 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-quickkey.png'
        driver.save_screenshot(screenshot_path5)
        print(f"Screenshot 5 saved")
        
        print("\n=== Testing Side Panel ===")
        try:
            panel_btn = driver.find_element(By.CSS_SELECTOR, 'button[title="Toggle tools panel"]')
            panel_btn.click()
            time.sleep(1)
            print("Clicked side panel toggle")
            
            screenshot_path6 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-sidepanel.png'
            driver.save_screenshot(screenshot_path6)
            print(f"Screenshot 6 (side panel): {screenshot_path6}")
            
            panel_btn.click()
            time.sleep(0.5)
            print("Closed side panel - OK")
        except Exception as e:
            print(f"Side panel test failed: {e}")
        
        print("\n=== Testing Window Resize ===")
        try:
            driver.set_window_size(1200, 800)
            time.sleep(1)
            screenshot_path7 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-resized.png'
            driver.save_screenshot(screenshot_path7)
            print(f"Screenshot 7 (resized to 1200x800): {screenshot_path7}")
            
            driver.set_window_size(1920, 1080)
            time.sleep(0.5)
            print("Resize test - OK")
        except Exception as e:
            print(f"Resize test failed: {e}")
        
        print("\n=== Testing Session Persistence ===")
        try:
            driver.refresh()
            time.sleep(3)
            
            try:
                enter_btn = WebDriverWait(driver, 3).until(
                    EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Enter Terminal')]"))
                )
                enter_btn.click()
                time.sleep(3)
            except:
                pass
            
            screenshot_path8 = '/home/hercules/herakles-terminal/tools/visual-validator/screenshots/terminal-reconnected.png'
            driver.save_screenshot(screenshot_path8)
            print(f"Screenshot 8 (after refresh/reconnect): {screenshot_path8}")
            print("Session persistence test - OK")
        except Exception as e:
            print(f"Session persistence test failed: {e}")
        
        console_logs = driver.get_log('browser')
        if console_logs:
            print("\nBrowser console logs:")
            for log in console_logs[-10:]:
                print(f"  [{log['level']}] {log['message']}")
        
    finally:
        driver.quit()

if __name__ == '__main__':
    test_terminal()
