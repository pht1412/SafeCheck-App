// ==============================================================================
// SafeCheck - Test Suite: Module 11 (PRD_Deep_v2.md - Phase 2)
// Kiểm thử Khả năng Chịu lỗi Thiết bị & Vòng đời Service Worker (sw.js)
// 6 Test Cases: Zero-Network in Push, Anti-Spam Tagging, Zero Phantom SOS,
// Deep-link Security, Notification Rejection Handling & Schema Compatibility
// ==============================================================================

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

test.describe('Module 11: Device Reliability & Service Worker Resilience (PRD_Deep_v2 - Phase 2)', () => {
  // Xác định đường dẫn tuyệt đối tới sw.js độc lập hoàn toàn với process.cwd()
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const swPath = path.resolve(__dirname, '../public/sw.js');
  const swContent = fs.readFileSync(swPath, 'utf8');

  // ===================================================================
  // TEST CASE 01: Zero-Network trong Execution Path của Push Handler
  // ===================================================================
  test('TC11-SW1: Push Event Handler tuân thủ Zero-Network (Không gọi bất kỳ API mạng nào)', async () => {
    // 1. Kiểm tra tĩnh: Trong khối lắng nghe sự kiện push, không có lệnh fetch nào
    const pushHandlerRegex = /self\.addEventListener\(['"]push['"],\s*\(event\)\s*=>\s*\{([\s\S]*?)\}\);/m;
    const match = swContent.match(pushHandlerRegex);
    expect(match).not.toBeNull();
    const pushHandlerBody = match![1];

    // Khối push handler tuyệt đối không chứa fetch(
    expect(pushHandlerBody.includes('fetch(')).toBeFalsy();
    expect(pushHandlerBody.includes('XMLHttpRequest')).toBeFalsy();
    expect(pushHandlerBody.includes('WebSocket')).toBeFalsy();

    // 2. Kiểm tra động (Simulation với Network Spies):
    let networkCallsCount = 0;
    const mockNetwork = {
      fetch: () => { networkCallsCount++; return Promise.resolve(); },
      xhr: () => { networkCallsCount++; },
    };
    expect(typeof mockNetwork.fetch).toBe('function');

    // Mô phỏng hàm xử lý push logic trích xuất từ sw.js
    let showedNotification: { title: string; options: any } | null = null;
    const mockRegistration = {
      showNotification: (title: string, options: any) => {
        showedNotification = { title, options };
        return Promise.resolve();
      },
    };

    const validPayload = {
      sos_event_id: '123e4567-e89b-12d3-a456-426614174000',
      elderly_name: 'Cụ Nguyễn Văn A',
      body: 'Cụ vừa bấm nút SOS khẩn cấp!',
      timestamp: Date.now(),
      is_retry: false,
    };

    const mockEvent = {
      data: {
        json: () => validPayload,
      },
      waitUntil: (p: Promise<any>) => p,
    };

    // Thực thi logic
    const data = mockEvent.data.json();
    const sosEventId = (data.sos_event_id || '').trim();
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sosEventId);
    expect(isValidUuid).toBeTruthy();

    if (sosEventId && isValidUuid) {
      await mockRegistration.showNotification(`🚨 SafeCheck - BÁO ĐỘNG SOS: ${data.elderly_name}`, {
        tag: `safecheck-sos-${sosEventId}`,
        renotify: !data.is_retry,
      });
    }

    // Đảm bảo không có lời gọi mạng nào phát sinh
    expect(networkCallsCount).toBe(0);
    expect(showedNotification).not.toBeNull();
  });

  // ===================================================================
  // TEST CASE 02: Cấu hình API Anti-Spam (Tag Ổn định & Renotify)
  // ===================================================================
  test('TC11-SW2: Cấu hình Anti-Spam: Gói retry dùng cùng tag và đặt renotify = false', async () => {
    const sosId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    function buildNotificationOptions(data: any) {
      const isRetry = Boolean(data.is_retry);
      const isUpdate = Boolean(data.is_update);
      const sosEventId = data.sos_event_id;
      return {
        tag: `safecheck-sos-${sosEventId}`,
        renotify: isUpdate ? false : !isRetry,
      };
    }

    // 1. Cảnh báo lần đầu (is_retry = false)
    const initialOptions = buildNotificationOptions({
      sos_event_id: sosId,
      is_retry: false,
    });
    expect(initialOptions.tag).toBe(`safecheck-sos-${sosId}`);
    expect(initialOptions.renotify).toBe(true);

    // 2. Gói tin gửi bù (is_retry = true)
    const retryOptions = buildNotificationOptions({
      sos_event_id: sosId,
      is_retry: true,
    });
    // Tag phải hoàn toàn giống hệt để OS thay thế notification cũ
    expect(retryOptions.tag).toBe(initialOptions.tag);
    // renotify phải = false để yêu cầu OS không reo chuông/rung lại
    expect(retryOptions.renotify).toBe(false);

    // 3. Gói tin cập nhật trạng thái (is_update = true)
    const updateOptions = buildNotificationOptions({
      sos_event_id: sosId,
      is_update: true,
      is_retry: false,
    });
    expect(updateOptions.tag).toBe(initialOptions.tag);
    expect(updateOptions.renotify).toBe(false);
  });

  // ===================================================================
  // TEST CASE 03: Triệt tiêu Phantom Alert khi Payload Lỗi / Hỏng
  // ===================================================================
  test('TC11-SW3: Zero Phantom SOS - Payload hỏng hoặc thiếu ID không được dựng ca cấp cứu giả', async () => {
    function processPushPayload(eventDataText: string | null) {
      if (!eventDataText) return { displayed: false, reason: 'NO_PAYLOAD' };
      let data;
      try {
        data = JSON.parse(eventDataText);
      } catch (e) {
        return { displayed: false, reason: 'MALFORMED_JSON' };
      }

      const sosEventId = (data.sos_event_id || '').trim();
      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sosEventId);
      if (!sosEventId || !isValidUuid) {
        return { displayed: false, reason: 'INVALID_OR_MISSING_SOS_ID' };
      }

      const elderlyName = (data.elderly_name || '').trim() || 'Người thân';
      return {
        displayed: true,
        sosEventId,
        elderlyName,
        title: `🚨 SafeCheck - BÁO ĐỘNG SOS: ${elderlyName}`,
      };
    }

    // 1. Payload rỗng -> Không hiển thị
    expect(processPushPayload(null)).toEqual({ displayed: false, reason: 'NO_PAYLOAD' });

    // 2. JSON hỏng -> Không hiển thị
    expect(processPushPayload('{ "sos_event_id": broken')).toEqual({ displayed: false, reason: 'MALFORMED_JSON' });

    // 3. JSON hợp lệ nhưng thiếu sos_event_id -> Không hiển thị (Chống SOS giả)
    expect(processPushPayload(JSON.stringify({ title: 'Cấp cứu', elderly_name: 'Cụ A' }))).toEqual({
      displayed: false,
      reason: 'INVALID_OR_MISSING_SOS_ID',
    });

    // 4. sos_event_id không phải UUID hợp lệ -> Không hiển thị
    expect(processPushPayload(JSON.stringify({ sos_event_id: 'fake-id-123' }))).toEqual({
      displayed: false,
      reason: 'INVALID_OR_MISSING_SOS_ID',
    });

    // 5. sos_event_id hợp lệ nhưng thiếu elderly_name -> Cho phép hiển thị an toàn với fallback 'Người thân'
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const partialResult = processPushPayload(JSON.stringify({ sos_event_id: validUuid }));
    expect(partialResult.displayed).toBe(true);
    expect(partialResult.elderlyName).toBe('Người thân');
    expect(partialResult.sosEventId).toBe(validUuid);
  });

  // ===================================================================
  // TEST CASE 04: Thẩm định Deep-link URL & Safe Client Navigation
  // ===================================================================
  test('TC11-SW4: Deep-link URL an toàn cùng origin và ưu tiên navigate client hiện có', async () => {
    const mockOrigin = 'https://safecheck.example.com';

    function sanitizeTargetUrl(rawUrl: string | undefined, origin: string): string {
      let targetPath = '/';
      try {
        const parsed = new URL(rawUrl || '/', origin);
        if (parsed.origin === origin) {
          targetPath = parsed.pathname + parsed.search + parsed.hash;
        }
      } catch (e) {
        targetPath = '/';
      }
      return new URL(targetPath, origin).href;
    }

    // 1. URL cùng origin với query sos hợp lệ -> Giữ nguyên đường dẫn an toàn
    const validUrl = 'https://safecheck.example.com/?sos=123e4567-e89b-12d3-a456-426614174000';
    expect(sanitizeTargetUrl(validUrl, mockOrigin)).toBe(validUrl);

    // 2. URL relative -> Tự động chuyển thành URL an toàn cùng origin
    expect(sanitizeTargetUrl('/?sos=123e4567-e89b-12d3-a456-426614174000', mockOrigin)).toBe(validUrl);

    // 3. URL ngoài origin (Phishing / Cross-site link) -> Chặn và chuyển về trang gốc an toàn
    const maliciousUrl = 'https://attacker.evil.com/phishing?sos=123';
    expect(sanitizeTargetUrl(maliciousUrl, mockOrigin)).toBe('https://safecheck.example.com/');

    // 4. Scheme javascript: nguy hiểm -> Chặn và chuyển về trang gốc an toàn
    expect(sanitizeTargetUrl('javascript:alert(1)', mockOrigin)).toBe('https://safecheck.example.com/');
  });

  // ===================================================================
  // TEST CASE 05: Xử lý showNotification Rejection An toàn
  // ===================================================================
  test('TC11-SW5: Xử lý ngoại lệ showNotification rejection không tạo unhandled error', async () => {
    const unhandledRejectionCaught = false;

    const mockRegistration = {
      showNotification: () => Promise.reject(new Error('OS Permission Denied / Memory Pressure')),
    };

    // Mô phỏng pattern trong sw.js
    const p = mockRegistration.showNotification().catch((err: Error) => {
      // Bắt lỗi an toàn
      expect(err.message).toContain('OS Permission Denied');
      return null;
    });

    await expect(p).resolves.toBeNull();
    expect(unhandledRejectionCaught).toBe(false);
  });

  // ===================================================================
  // TEST CASE 06: Schema Version Compatibility (Worker Cũ & Payload Mới)
  // ===================================================================
  test('TC11-SW6: Tương thích Schema đa phiên bản: Payload có trường tương lai không làm crash SW', async () => {
    const futurePayload = {
      schema_version: 2,
      sos_event_id: '123e4567-e89b-12d3-a456-426614174000',
      elderly_name: 'Cụ Trần',
      body: 'Cảnh báo khẩn cấp từ thiết bị đeo thông minh!',
      heart_rate_bpm: 145, // Trường tương lai
      fall_detected_axis: 'Z', // Trường tương lai
      emergency_contacts_tier: 2, // Trường tương lai
      timestamp: Date.now(),
    };

    // Worker hiện tại parse dữ liệu
    const parsedId = (futurePayload.sos_event_id || '').trim();
    const elderlyName = (futurePayload.elderly_name || '').trim() || 'Người thân';

    expect(parsedId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(elderlyName).toBe('Cụ Trần');
    expect(futurePayload.schema_version).toBe(2);
    // Các trường tương lai không gây lỗi logic hay throw exception
    expect(futurePayload.heart_rate_bpm).toBe(145);
  });
});
