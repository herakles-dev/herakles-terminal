import { test, expect } from '@playwright/test';

test.describe('Music Player Toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Collect console logs
    page.on('console', msg => {
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
    });

    // Collect errors
    page.on('pageerror', error => {
      console.log(`[BROWSER ERROR]`, error.message);
    });

    await page.goto('/');

    // Wait for welcome screen and click Enter Terminal
    await page.waitForSelector('button:has-text("Enter Terminal")', { timeout: 10000 });
    await page.click('button:has-text("Enter Terminal")');

    // Wait for terminal to load
    await page.waitForSelector('.terminal-container', { timeout: 15000 });
  });

  test('toggle button should open music player', async ({ page }) => {
    // Find the music player toggle button (music note icon, bottom-left)
    const toggleButton = page.locator('button[title*="Music Player"]');

    // Verify button exists
    await expect(toggleButton).toBeVisible({ timeout: 5000 });
    console.log('[TEST] Toggle button found');

    // Check initial state - button should NOT have active styling
    const initialClasses = await toggleButton.getAttribute('class');
    console.log('[TEST] Initial button classes:', initialClasses);

    // Click the toggle button
    await toggleButton.click();
    console.log('[TEST] Clicked toggle button');

    // Wait a moment for state to update
    await page.waitForTimeout(500);

    // Check if button now has active styling
    const afterClickClasses = await toggleButton.getAttribute('class');
    console.log('[TEST] After click button classes:', afterClickClasses);

    // Look for the music player element
    const musicPlayer = page.locator('.music-player');
    const playerCount = await musicPlayer.count();
    console.log('[TEST] Music player elements found:', playerCount);

    if (playerCount > 0) {
      const playerClasses = await musicPlayer.first().getAttribute('class');
      console.log('[TEST] Music player classes:', playerClasses);

      const isVisible = await musicPlayer.first().isVisible();
      console.log('[TEST] Music player visible:', isVisible);

      // Get computed styles
      const styles = await musicPlayer.first().evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          display: computed.display,
          visibility: computed.visibility,
          opacity: computed.opacity,
          position: computed.position,
          left: computed.left,
          top: computed.top,
          width: computed.width,
          height: computed.height,
          zIndex: computed.zIndex,
        };
      });
      console.log('[TEST] Music player computed styles:', JSON.stringify(styles, null, 2));
    }

    // Take a screenshot for visual debugging
    await page.screenshot({ path: 'e2e/screenshots/music-player-toggle.png', fullPage: true });
    console.log('[TEST] Screenshot saved to e2e/screenshots/music-player-toggle.png');

    // The actual assertion - player should be visible
    await expect(musicPlayer.first()).toBeVisible({ timeout: 3000 });
  });

  test('debug: inspect DOM after toggle click', async ({ page }) => {
    const toggleButton = page.locator('button[title*="Music Player"]');
    await toggleButton.click();
    await page.waitForTimeout(1000);

    // Get full HTML of any music-player related elements
    const html = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="music"]');
      return Array.from(elements).map(el => ({
        tagName: el.tagName,
        className: el.className,
        id: el.id,
        innerHTML: el.innerHTML.substring(0, 500),
        boundingRect: el.getBoundingClientRect(),
      }));
    });

    console.log('[TEST] Music-related DOM elements:', JSON.stringify(html, null, 2));

    // Also check React state via window (if exposed)
    const reactState = await page.evaluate(() => {
      // Try to find React fiber
      const root = document.getElementById('root');
      if (root && (root as any)._reactRootContainer) {
        return 'React root found';
      }
      return 'React root not directly accessible';
    });
    console.log('[TEST] React state access:', reactState);
  });
});
