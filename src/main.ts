/**
 * CLST Application Entry Point
 * Bootstraps database, audio, and main application
 */

import { MainApp } from '@/views/MainApp';
import { db } from '@/lib/database';
import { getAudioManager } from '@/lib/audioManager';

// Styles
import '@/assets/styles/base.css';
import '@/assets/styles/main.css';
import '@/assets/styles/checkin.css';
import '@/assets/styles/configuration.css';
import '@/assets/styles/results.css';
import '@/assets/styles/dashboard.css';

let app: MainApp | null = null;

async function bootstrap(): Promise<void> {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    showError('Application container not found');
    return;
  }

  showLoading();

  try {
    // Check browser compatibility
    checkCompatibility();

    // Initialize core services
    await db.initialize();
    await getAudioManager().init();

    // Create and start main app
    app = new MainApp(appContainer);
    await app.init();

    hideLoading();
  } catch (error) {
    console.error('Bootstrap failed:', error);
    showError(`Failed to start application: ${error}`);
  }
}

function checkCompatibility(): void {
  const required = [
    'requestAnimationFrame' in window,
    'Promise' in window,
    'fetch' in window,
    typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined',
  ];
  if (required.some(r => !r)) {
    throw new Error('Browser does not meet minimum requirements');
  }
}

function showLoading(): void {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'flex';
}

function hideLoading(): void {
  const el = document.getElementById('loading-screen');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }
}

function showError(message: string): void {
  hideLoading();
  const el = document.getElementById('error-screen');
  if (el) {
    el.style.display = 'flex';
    const msgEl = el.querySelector('.error-message');
    if (msgEl) msgEl.textContent = message;
  }
}

// Global error handlers
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
});

// Focus/blur tracking for potential test pause
window.addEventListener('blur', () => {
  // Could pause test if running
});

window.addEventListener('focus', () => {
  // Could resume test
});

// Start
bootstrap();
