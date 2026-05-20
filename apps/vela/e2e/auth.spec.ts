import { test, expect, type Page } from '@playwright/test';
import { waitForPageLoad } from './utils/helpers';

const expectGoogleOnlyAuthSurface = async (page: Page) => {
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(1);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /create account/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^sign in$/i })).toHaveCount(0);
  await expect(page.getByText(/forgot password/i)).toHaveCount(0);
  await expect(page.getByText(/sign up/i)).toHaveCount(0);
};

test.describe('Authentication', () => {
  test('shows Google-only login without credential controls', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    await expect(page).toHaveTitle(/Vela/);
    await expect(page.getByText('Welcome to Vela')).toBeVisible();
    await expect(page.getByText('Continue with Google to start learning Japanese')).toBeVisible();
    await expectGoogleOnlyAuthSurface(page);
  });

  test('keeps signup route on the same Google-only auth surface', async ({ page }) => {
    await page.goto('/auth/signup');
    await waitForPageLoad(page);

    await expect(page).toHaveURL(/\/auth\/signup/);
    await expectGoogleOnlyAuthSurface(page);
  });

  test('does not expose password reset controls', async ({ page }) => {
    await page.goto('/auth/reset-password');
    await waitForPageLoad(page);

    await expect(page).toHaveURL(/\/auth\/reset-password/);
    await expectGoogleOnlyAuthSurface(page);
  });

  test('redirects protected routes to Google-only login with return target', async ({ page }) => {
    await page.goto('/progress');
    await waitForPageLoad(page);

    await expect.poll(() => page.url()).toContain('/auth/login');
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/progress');
    await expectGoogleOnlyAuthSurface(page);
  });
});
