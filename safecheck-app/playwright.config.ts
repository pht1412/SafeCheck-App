import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Đặt fullyParallel: false và workers: 1 vì các test thao tác chung trên tài khoản Cụ và Database thực tế
  fullyParallel: false,
  workers: 1,
  reporter: 'html',
  use: {
    // Địa chỉ web app Vite của bạn
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Tự động chạy server nếu bạn quên chạy 'npm run dev'
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});