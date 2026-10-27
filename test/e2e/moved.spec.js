import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers.js';

// Math Cross steckt jetzt in „Coop Number Games" — der Startbildschirm der alten
// App weist dauerhaft darauf hin und verlinkt direkt ins Spiel Math Cross.
test('Startbildschirm zeigt den Umzugs-Hinweis mit Link zur neuen App', async ({ page }) => {
  await gotoApp(page);
  const banner = page.locator('.screen.home .moved-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('umgezogen');
  await expect(banner.locator('.moved-btn')).toHaveAttribute('href', 'https://tomanderss.github.io/coop-number-sums/?game=mathcross');
  // Der Hinweis darf auf dem Handy nichts aus dem Bild schieben.
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(scroll).toBe(true);
});

// Ohne Konto bleiben die Daten im Speicher dieser App (native App / iPhone-
// Homescreen-App teilen ihn nicht) — der Hinweis führt direkt zur Registrierung.
test('ohne Konto führt der Hinweis zur Registrierung', async ({ page }) => {
  await gotoApp(page);
  const extra = page.locator('.moved-banner .moved-account');
  await expect(extra).toBeVisible();
  await extra.locator('.moved-signup').click();
  await expect.poll(() => page.evaluate(() => [window.__cns.state.settingsTab, window.__cns.state.account.mode].join('/'))).toBe('konto/up');
});
