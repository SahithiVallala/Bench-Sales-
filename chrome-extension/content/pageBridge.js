/**
 * Page Bridge Content Script
 * Runs on localhost:3000 (the bench sales platform frontend).
 * Listens for postMessage from the page and forwards commands to the background service worker.
 * Also relays state updates back to the page.
 */

(() => {
  'use strict';

  // Listen for messages from the React page
  window.addEventListener('message', async (event) => {
    // Security: only accept messages from same origin
    if (event.origin !== window.location.origin) return;
    if (event.data?.source !== 'BENCH_SALES_PLATFORM') return;

    const { type, payload } = event.data;

    if (type === 'PING') {
      window.postMessage({
        source: 'BENCH_SALES_EXTENSION',
        type: 'PONG',
      }, '*');
      return;
    }

    if (type === 'START_AUTO_APPLY') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'START_SESSION',
          payload,
        });

        // Relay result back to the page
        window.postMessage({
          source: 'BENCH_SALES_EXTENSION',
          type: 'SESSION_STARTED',
          payload: response,
        }, '*');
      } catch (err) {
        // Extension not installed or unavailable
        window.postMessage({
          source: 'BENCH_SALES_EXTENSION',
          type: 'EXTENSION_ERROR',
          payload: { error: 'Extension not found. Please install the Bench Sales Auto Apply extension.' },
        }, '*');
      }
    }

    if (type === 'GET_SESSION_STATE') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        window.postMessage({
          source: 'BENCH_SALES_EXTENSION',
          type: 'SESSION_STATE',
          payload: response?.state,
        }, '*');
      } catch (_) {}
    }

    if (type === 'START_LINKEDIN_HARVEST') {
      try {
        await chrome.runtime.sendMessage({ type: 'START_HARVEST', payload });
        window.postMessage({
          source: 'BENCH_SALES_EXTENSION',
          type: 'LINKEDIN_HARVEST_STARTED',
        }, '*');
      } catch (err) {
        window.postMessage({
          source: 'BENCH_SALES_EXTENSION',
          type: 'EXTENSION_ERROR',
          payload: { error: 'Extension not found. Please install the Bench Sales extension.' },
        }, '*');
      }
    }
  });

  // Forward background messages to the page
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      window.postMessage({
        source: 'BENCH_SALES_EXTENSION',
        type: 'SESSION_STATE',
        payload: message.state,
      }, '*');
    }

    if (message.type === 'LINKEDIN_HARVEST_COMPLETE') {
      window.postMessage({
        source: 'BENCH_SALES_EXTENSION',
        type: 'LINKEDIN_HARVEST_COMPLETE',
        payload: { jobs: message.jobs, total: message.total },
      }, '*');
    }

    if (message.type === 'HARVEST_PROGRESS') {
      window.postMessage({
        source: 'BENCH_SALES_EXTENSION',
        type: 'LINKEDIN_HARVEST_PROGRESS',
        payload: { found: message.found, cycle: message.cycle, total_cycles: message.total_cycles },
      }, '*');
    }
  });

  // Signal to the page that the extension is installed
  window.postMessage({
    source: 'BENCH_SALES_EXTENSION',
    type: 'EXTENSION_READY',
  }, '*');
})();
