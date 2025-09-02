import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('should display login form with correct layout', async ({ page }) => {
    // Navigate to login page
    await page.goto('/auth/login');

    // Check page title
    await expect(page).toHaveTitle(/Vela/);

    // Check main heading
    await expect(page.getByRole('heading', { name: '日本語学習' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Japanese Learning App' })).toBeVisible();

    // Check form elements
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Magic Link' })).toBeVisible();

    // Check sign up link
    await expect(page.getByRole('link', { name: 'Sign Up' })).toBeVisible();

    // Check forgot password link
    await expect(page.getByRole('button', { name: 'Forgot Password?' })).toBeVisible();
  });
});
