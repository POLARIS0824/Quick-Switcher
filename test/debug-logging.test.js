'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Test debug logging subsystem (circular buffer, FIFO truncation, export formatting)
 */
test('debug logging: circular buffer caps at DEBUG_LOGS_MAX_ENTRIES (100) and discards oldest', () => {
  const DEBUG_LOGS_MAX_ENTRIES = 100;
  const debugLogsMemoryCache = [];

  function formatLogTimestamp(ts) {
    const d = new Date(ts);
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  function appendDebugLog(category, message, details, level = 'info') {
    const now = Date.now();
    const entry = {
      time: formatLogTimestamp(now),
      timestamp: now,
      level,
      category,
      message: String(message || ''),
      details: details && typeof details === 'object' ? details : undefined
    };
    debugLogsMemoryCache.push(entry);
    if (debugLogsMemoryCache.length > DEBUG_LOGS_MAX_ENTRIES) {
      debugLogsMemoryCache.splice(0, debugLogsMemoryCache.length - DEBUG_LOGS_MAX_ENTRIES);
    }
  }

  // Push 120 entries
  for (let i = 1; i <= 120; i++) {
    appendDebugLog('test', `Log message ${i}`, { index: i });
  }

  assert.equal(debugLogsMemoryCache.length, 100);
  assert.equal(debugLogsMemoryCache[0].message, 'Log message 21', 'Oldest entries 1-20 should be evicted');
  assert.equal(debugLogsMemoryCache[99].message, 'Log message 120', 'Latest entry should be kept');
  assert.equal(debugLogsMemoryCache[99].level, 'info');
  assert.deepEqual(debugLogsMemoryCache[99].details, { index: 120 });
});

test('debug logging: formatLogsForExport converts logs to readable multiline text', () => {
  function formatLogsForExport(logs) {
    if (!Array.isArray(logs) || !logs.length) {
      return '';
    }
    return logs.map((entry) => {
      const time = entry && entry.time ? entry.time : '';
      const level = entry && entry.level ? `[${entry.level.toUpperCase()}]` : '';
      const category = entry && entry.category ? `[${entry.category}]` : '';
      const msg = entry && entry.message ? entry.message : '';
      const details = entry && entry.details ? ` ${JSON.stringify(entry.details)}` : '';
      return `${time} ${level} ${category} ${msg}${details}`.trim();
    }).join('\n');
  }

  const logs = [
    {
      time: '2026-09-18 22:45:01.123',
      level: 'info',
      category: 'command',
      message: 'Shortcut triggered',
      details: { tabId: 10 }
    },
    {
      time: '2026-09-18 22:45:01.150',
      level: 'warn',
      category: 'fallback',
      message: 'In-page overlay unavailable (page-not-focused)',
      details: { activeTabId: 10, reason: 'page-not-focused' }
    }
  ];

  const formatted = formatLogsForExport(logs);
  const lines = formatted.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '2026-09-18 22:45:01.123 [INFO] [command] Shortcut triggered {"tabId":10}');
  assert.equal(lines[1], '2026-09-18 22:45:01.150 [WARN] [fallback] In-page overlay unavailable (page-not-focused) {"activeTabId":10,"reason":"page-not-focused"}');
});
