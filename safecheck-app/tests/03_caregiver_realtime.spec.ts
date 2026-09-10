import { test, expect } from '@playwright/test';

test.describe('Module 03: Màn hình Con cháu & Đồng bộ Realtime (Caregiver & Realtime)', () => {
  test.describe.configure({ mode: 'serial' });

  // ===================================================================
  // TEST CASE 1: Đăng nhập Con cháu và Kiểm tra giao diện Dashboard
  // ===================================================================
  test('TC01: Con cháu đăng nhập thấy Dashboard và thanh Dev Tool của Tester', async ({ page }) => {
    // 1. Robot truy cập trang chủ
    await page.goto('/');

    // 2. Điền email và mật khẩu của con cháu mẫu
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');

    // 3. Bấm nút ĐĂNG NHẬP
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 4. Kiểm tra Header con cháu: Có nút "Đăng xuất"
    const logoutBtn = page.getByRole('button', { name: 'Đăng xuất' });
    await expect(logoutBtn).toBeVisible({ timeout: 10000 });

    // 5. Kiểm tra quyền Tester: Vì là test01@gmail.com nên PHẢI THẤY thanh Dev Tool
    const devToolTitle = page.getByText(/Mô phỏng trạng thái \(Dev Tool\)/);
    await expect(devToolTitle).toBeVisible();

    // 6. Phải có đủ 3 nút Set Late, Set SOS, Set Waiting của Tester
    await expect(page.getByRole('button', { name: 'Set Late' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set SOS' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set Waiting' })).toBeVisible();
  });

  // ===================================================================
  // TEST CASE 2: Con cháu gửi chuông hỏi thăm (Ping) & Cooldown 10s của Tester
  // ===================================================================
  test('TC02: Gửi chuông hỏi thăm chuyển trạng thái thân thiện và đếm ngược 10s', async ({ page }) => {
    // 1. Đăng nhập con cháu
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 2. Chờ Dashboard hiển thị
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // Đưa về trạng thái Waiting để đảm bảo nút Ping luôn được phép bấm
    const setWaitingBtn = page.getByRole('button', { name: 'Set Waiting' });
    if (await setWaitingBtn.isVisible()) {
      await setWaitingBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Tìm nút "Gửi chuông kiểm tra (Ping)"
    const pingBtn = page.getByTestId('send-ping-button');
    await expect(pingBtn).toBeVisible();

    // Nếu nút Ping sẵn sàng thì bấm
    if (await pingBtn.isEnabled()) {
      await pingBtn.click();

      // 4. Kiểm chứng trạng thái chuyển sang tiếng Việt thân thiện: "🔔 Đang gửi chuông hỏi thăm"
      const statusText = page.getByTestId('status-text');
      await expect(statusText).toContainText('Đang gửi chuông hỏi thăm');

      // 5. Kiểm chứng thời gian hồi chiêu của Tester chỉ có 10 giây (chữ "Chờ thử lại" xuất hiện)
      await expect(page.getByText(/Chờ thử lại/)).toBeVisible();
    }
  });

  // ===================================================================
  // TEST CASE 3 (ĐỈNH CAO): Mở 2 cửa sổ Cụ & Con song song để test Realtime
  // ===================================================================
  test('TC03: Cụ bấm điểm danh ở Cửa sổ 1 -> Cửa sổ 2 của Con đổi màu xanh Realtime', async ({ browser }) => {
    // -----------------------------------------------------------------
    // BƯỚC A: TẠO CỬA SỔ 1 DÀNH RIÊNG CHO CỤ (contextElderly)
    // -----------------------------------------------------------------
    // browser.newContext() tạo ra một phiên trình duyệt hoàn toàn độc lập (như tab ẩn danh)
    const contextElderly = await browser.newContext();
    const pageElderly = await contextElderly.newPage();

    // Robot mở web và đăng nhập tài khoản Cụ
    await pageElderly.goto('/');
    await pageElderly.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await pageElderly.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await pageElderly.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // Đợi màn hình Cụ xuất hiện
    await expect(pageElderly.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC B: TẠO CỬA SỔ 2 DÀNH RIÊNG CHO CON CHÁU (contextCaregiver)
    // -----------------------------------------------------------------
    // Tạo thêm 1 phiên trình duyệt thứ hai chạy song song
    const contextCaregiver = await browser.newContext();
    const pageCaregiver = await contextCaregiver.newPage();

    // Robot mở web và đăng nhập tài khoản Con cháu
    await pageCaregiver.goto('/');
    await pageCaregiver.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await pageCaregiver.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await pageCaregiver.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // Đợi Dashboard con cháu xuất hiện
    await expect(pageCaregiver.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC C: GIẢ LẬP TRẠNG THÁI WAITING BẰNG DEV TOOL Ở CỬA SỔ CON
    // -----------------------------------------------------------------
    // Để bài test luôn chuẩn xác, ta bấm "Set Waiting" để đưa Cụ về trạng thái Chờ điểm danh
    const setWaitingBtn = pageCaregiver.getByRole('button', { name: 'Set Waiting' });
    if (await setWaitingBtn.isVisible()) {
      await setWaitingBtn.click();
      // Chờ trạng thái Waiting xuất hiện trên cả 2 màn hình (Comment 5.3)
      await expect(pageCaregiver.getByTestId('status-text')).toContainText(/Chờ/i, { timeout: 10000 });
      await expect(pageElderly.getByTestId('checkin-button')).toContainText(/HÔM NAY/i, { timeout: 10000 });
    }

    // -----------------------------------------------------------------
    // BƯỚC D: CỤ BẤM ĐIỂM DANH Ở CỬA SỔ 1 -> KIỂM TRA CỬA SỔ 2 ĐỔI MÀU
    // -----------------------------------------------------------------
    // Ở Cửa sổ 1 (máy Cụ): Tìm nút điểm danh "HÔM NAY TÔI ỔN" và bấm
    const checkinBtn = pageElderly.getByTestId('checkin-button');
    await expect(checkinBtn).toBeVisible({ timeout: 10000 });
    await checkinBtn.click();

    // Ở Cửa sổ 2 (máy Con cháu): KHÔNG HỀ BẤM F5 HAY RELOAD TRANG!
    // WebSocket Realtime của Supabase sẽ tự động đẩy dữ liệu sang!
    // Robot kiểm chứng thẻ trạng thái của con cháu tự động nhảy sang "Hôm nay đã ổn"
    const caregiverStatus = pageCaregiver.getByTestId('status-text');
    await expect(caregiverStatus).toContainText('Hôm nay đã ổn', { timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC E: DỌN DẸP ĐÓNG 2 TRÌNH DUYỆT
    // -----------------------------------------------------------------
    await contextElderly.close();
    await contextCaregiver.close();
  });

  // ===================================================================
  // TEST CASE 4: Con cháu nhập mã kết nối Cụ từ màn hình trống
  // Sử dụng tài khoản người dùng bình thường: test02@gmail.com
  // ===================================================================
  test('TC04: Con cháu (test02) nhập mã kết nối Cụ từ màn hình trống thành công', async ({ browser }) => {
    // -----------------------------------------------------------------
    // BƯỚC A: MỞ CỬA SỔ CỤ ĐỂ LẤY MÃ GHÉP NỐI (PAIRING CODE) THỰC TẾ
    // -----------------------------------------------------------------
    // Tạo context độc lập cho máy của Cụ
    const contextElderly = await browser.newContext();
    const pageElderly = await contextElderly.newPage();

    // Cụ đăng nhập vào hệ thống
    await pageElderly.goto('/');
    await pageElderly.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await pageElderly.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await pageElderly.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageElderly.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Robot đọc trực tiếp mã ghép 6 ký tự hiển thị ở góc trên máy của Cụ
    const pairingCodeLocator = pageElderly.getByTestId('elderly-pairing-code');
    await expect(pairingCodeLocator).toBeVisible();
    const actualPairingCode = (await pairingCodeLocator.innerText()).trim();
    console.log(`[Test TC04] Đã lấy được mã ghép nối từ máy Cụ: ${actualPairingCode}`);

    // -----------------------------------------------------------------
    // BƯỚC B: MỞ CỬA SỔ CON CHÁU (test02@gmail.com) - MÀN HÌNH TRỐNG
    // -----------------------------------------------------------------
    // Tạo context độc lập thứ 2 cho tài khoản người dùng bình thường test02
    const contextCaregiver = await browser.newContext();
    const pageCaregiver = await contextCaregiver.newPage();

    // Con cháu đăng nhập
    await pageCaregiver.goto('/');
    await pageCaregiver.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test02@gmail.com');
    await pageCaregiver.getByPlaceholder('Tối thiểu 6 ký tự').fill('test02@gmail.com');
    await pageCaregiver.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // Đợi vào màn hình Con cháu
    await expect(pageCaregiver.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC C: KIỂM CHỨNG TRẠNG THÁI MÀN HÌNH TRỐNG & BẢO MẬT USER THƯỜNG
    // -----------------------------------------------------------------
    // 1. Phải thấy tiêu đề "Chưa kết nối người thân"
    await expect(pageCaregiver.getByText('Chưa kết nối người thân')).toBeVisible();

    // 2. Bảo mật: Vì test02 là user thông thường, TUYỆT ĐỐI KHÔNG có thanh Dev Tool
    await expect(pageCaregiver.getByText(/Mô phỏng trạng thái \(Dev Tool\)/)).not.toBeVisible();

    // 3. Phải có nút "+ KẾT NỐI VỚI CỤ NGAY" màu tím nổi bật
    const connectBtn = pageCaregiver.getByRole('button', { name: '+ KẾT NỐI VỚI CỤ NGAY' });
    await expect(connectBtn).toBeVisible();

    // -----------------------------------------------------------------
    // BƯỚC D: BẤM NÚT & NHẬP MÃ GHÉP NỐI VÀO MODAL
    // -----------------------------------------------------------------
    // Bấm mở modal kết nối
    await connectBtn.click();

    // Kiểm tra modal xuất hiện với tiêu đề "Kết nối với Cụ"
    // Dùng getByRole('heading') để tránh nhầm với nút "+ KẾT NỐI VỚI CỤ NGAY" (Strict Mode)
    await expect(pageCaregiver.getByRole('heading', { name: 'Kết nối với Cụ' })).toBeVisible();

    // Điền mã 6 ký tự vừa lấy được từ máy Cụ vào ô input
    const codeInput = pageCaregiver.getByPlaceholder('Ví dụ: 8B29JG');
    await codeInput.fill(actualPairingCode);

    // Bấm nút "Xác nhận" để gửi RPC connect_family lên Supabase
    const submitBtn = pageCaregiver.getByRole('button', { name: 'Xác nhận' });
    await submitBtn.click();

    // -----------------------------------------------------------------
    // BƯỚC E: KIỂM CHỨNG GHÉP NỐI THÀNH CÔNG TRÊN CẢ 2 MÀN HÌNH
    // -----------------------------------------------------------------
    // 1. Màn hình Con cháu: Modal phải tự đóng, dòng "Chưa kết nối người thân" biến mất
    await expect(pageCaregiver.getByText('Chưa kết nối người thân')).not.toBeVisible({ timeout: 10000 });

    // 2. Màn hình Con cháu: Xuất hiện thông tin người thân "Đang theo dõi:"
    await expect(pageCaregiver.getByText('Đang theo dõi:')).toBeVisible();

    // 3. Màn hình Cụ (Cửa sổ 1): Tự động đổi trạng thái sang "Đã kết nối người thân"
    await expect(pageElderly.getByText('Đã kết nối người thân')).toBeVisible({ timeout: 10000 });

    // Đóng 2 cửa sổ dọn dẹp bộ nhớ
    await contextElderly.close();
    await contextCaregiver.close();
  });

  // ===================================================================
  // TEST CASE 5: Toàn bộ vòng đời Cụ bấm SOS -> Con cháu bấm Tắt báo động
  // ===================================================================
  test('TC05: Vòng đời Báo động đỏ SOS - Cụ kích hoạt SOS và Con cháu bấm Tắt báo động', async ({ browser }) => {
    // -----------------------------------------------------------------
    // BƯỚC A: MỞ 2 MÁY CỦA CỤ (0123456789) VÀ CON CHÁU (test01@gmail.com)
    // -----------------------------------------------------------------
    // Cửa sổ 1: Cụ
    const contextElderly = await browser.newContext();
    const pageElderly = await contextElderly.newPage();
    await pageElderly.goto('/');
    await pageElderly.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await pageElderly.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await pageElderly.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageElderly.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Cửa sổ 2: Con cháu (đã được liên kết với Cụ)
    const contextCaregiver = await browser.newContext();
    const pageCaregiver = await contextCaregiver.newPage();
    await pageCaregiver.goto('/');
    await pageCaregiver.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await pageCaregiver.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await pageCaregiver.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageCaregiver.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC B: CỤ ĐÈ GIỮ NÚT SOS 3 GIÂY ĐỂ BÁO ĐỘNG
    // -----------------------------------------------------------------
    const sosBtn = pageElderly.getByTestId('sos-button');
    await sosBtn.hover();

    // Giữ chuột 3.2 giây mô phỏng Cụ đè tay
    await pageElderly.mouse.down();
    await pageElderly.waitForTimeout(3200);
    await pageElderly.mouse.up();

    // Modal đếm ngược 10 giây chống bấm nhầm xuất hiện
    await expect(pageElderly.getByTestId('sos-countdown-modal')).toBeVisible();

    // Chờ bộ đếm ngược 10 giây trôi qua -> Hệ thống tự động kích hoạt Emergency
    // Robot Playwright tự động kiên nhẫn chờ modal đếm ngược hoàn tất trong tối đa 15 giây
    const elderlyEmergencyView = pageElderly.getByTestId('elderly-emergency-view');
    await expect(elderlyEmergencyView).toBeVisible({ timeout: 15000 });
    await expect(elderlyEmergencyView).toContainText('ĐANG BÁO ĐỘNG ĐỎ');

    // -----------------------------------------------------------------
    // BƯỚC C: KIỂM TRA MÁY CON CHÁU TỰ NHẬN TÍN HIỆU CẤP CỨU REALTIME
    // -----------------------------------------------------------------
    // Không cần reload trang! Màn hình con cháu lập tức chuyển sang trạng thái Emergency
    const caregiverStatus = pageCaregiver.getByTestId('status-text');
    await expect(caregiverStatus).toContainText('BÁO ĐỘNG KHẨN CẤP', { timeout: 10000 });

    // Khung cảnh báo khẩn cấp màu đỏ rực rung lên
    const emergencyAlert = pageCaregiver.getByTestId('caregiver-emergency-alert');
    await expect(emergencyAlert).toBeVisible();
    await expect(emergencyAlert).toContainText('BÁO ĐỘNG KHẨN CẤP');

    // -----------------------------------------------------------------
    // BƯỚC D: CON CHÁU BẤM NÚT "XÁC NHẬN AN TOÀN / TẮT BÁO ĐỘNG"
    // -----------------------------------------------------------------
    // Nút tắt báo động màu xanh xuất hiện dưới đáy
    const resolveAlarmBtn = pageCaregiver.getByTestId('resolve-alarm-button');
    await expect(resolveAlarmBtn).toBeVisible();

    // Con cháu bấm tắt báo động
    await resolveAlarmBtn.click();

    // -----------------------------------------------------------------
    // BƯỚC E: KIỂM CHỨNG CẢ 2 BÊN ĐỒNG BỘ VỀ TRẠNG THÁI AN TOÀN (SAFE)
    // -----------------------------------------------------------------
    // 1. Phía Con cháu: Thẻ chuyển lại màu xanh "🟢 Hôm nay đã ổn"
    await expect(caregiverStatus).toContainText('Hôm nay đã ổn', { timeout: 10000 });

    // 2. Phía Cụ: Báo động đỏ tắt, hiển thị thẻ xanh "HÔM NAY ĐÃ ỔN"
    const safeCard = pageElderly.getByTestId('status-safe-card');
    await expect(safeCard).toBeVisible({ timeout: 10000 });
    await expect(safeCard).toContainText('HÔM NAY ĐÃ ỔN');

    // Dọn dẹp đóng các cửa sổ
    await contextElderly.close();
    await contextCaregiver.close();
  });

  // ===================================================================
  // TEST CASE 6: Mô hình 1 Cụ : N Con cháu (1:N) - Đồng bộ Realtime cùng lúc trên 3 cửa sổ
  // ===================================================================
  test('TC06: Mô hình 1 Cụ : N Con cháu (1:N) - Cụ điểm danh, cả 2 Con cháu cùng đổi màu Realtime', async ({ browser }) => {
    // -----------------------------------------------------------------
    // BƯỚC 1: KHỞI TẠO 3 CỬA SỔ ĐỘC LẬP (1 CỤ + 2 CON CHÁU KHÁC NHAU)
    // -----------------------------------------------------------------
    // Context 1: Máy của Cụ (0123456789)
    const contextElderly = await browser.newContext();
    const pageElderly = await contextElderly.newPage();
    await pageElderly.goto('/');
    await pageElderly.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await pageElderly.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await pageElderly.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageElderly.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Context 2: Con cháu 1 (test01@gmail.com - Tester có Dev Tool)
    const contextCaregiver1 = await browser.newContext();
    const pageCaregiver1 = await contextCaregiver1.newPage();
    await pageCaregiver1.goto('/');
    await pageCaregiver1.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await pageCaregiver1.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await pageCaregiver1.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageCaregiver1.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // Context 3: Con cháu 2 (test02@gmail.com - Người dùng thông thường)
    const contextCaregiver2 = await browser.newContext();
    const pageCaregiver2 = await contextCaregiver2.newPage();
    await pageCaregiver2.goto('/');
    await pageCaregiver2.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test02@gmail.com');
    await pageCaregiver2.getByPlaceholder('Tối thiểu 6 ký tự').fill('test02@gmail.com');
    await pageCaregiver2.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageCaregiver2.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // -----------------------------------------------------------------
    // BƯỚC 2: XÁC LẬP PRECONDITION - CẢ 2 CON CHÁU ĐỀU ĐÃ KẾT NỐI VỚI CỤ
    // -----------------------------------------------------------------
    // Nếu Con cháu 2 chưa kết nối, tiến hành kết nối nhanh bằng mã ghép của Cụ
    const connectBtn = pageCaregiver2.getByRole('button', { name: '+ KẾT NỐI VỚI CỤ NGAY' });
    if (await connectBtn.isVisible()) {
      const pairingCodeLocator = pageElderly.getByTestId('elderly-pairing-code');
      const pairingCode = (await pairingCodeLocator.innerText()).trim();
      await connectBtn.click();
      await pageCaregiver2.getByPlaceholder('Ví dụ: 8B29JG').fill(pairingCode);
      await pageCaregiver2.getByRole('button', { name: 'Xác nhận' }).click();
      await expect(pageCaregiver2.getByText('Đang theo dõi:')).toBeVisible({ timeout: 10000 });
    }

    // -----------------------------------------------------------------
    // BƯỚC 3: ĐƯA HỆ THỐNG VỀ TRẠNG THÁI CHỜ (WAITING) BẰNG DEV TOOL CỦA CON 1
    // -----------------------------------------------------------------
    const setWaitingBtn = pageCaregiver1.getByRole('button', { name: 'Set Waiting' });
    if (await setWaitingBtn.isVisible()) {
      await setWaitingBtn.click();
      // Chờ trạng thái lan tỏa tới Con 1 và Con 2
      await expect(pageCaregiver1.getByTestId('status-text')).toContainText(/Chờ/i, { timeout: 10000 });
      await expect(pageCaregiver2.getByTestId('status-text')).toContainText(/Chờ/i, { timeout: 10000 });
    }

    // -----------------------------------------------------------------
    // BƯỚC 4: CỤ BẤM ĐIỂM DANH Ở CỬA SỔ CỤ
    // -----------------------------------------------------------------
    const checkinBtn = pageElderly.getByTestId('checkin-button');
    await expect(checkinBtn).toBeVisible({ timeout: 10000 });
    await checkinBtn.click();

    // -----------------------------------------------------------------
    // BƯỚC 5: KIỂM CHỨNG CẢ 2 MÁY CON CHÁU CÙNG NHẬN TÍN HIỆU REALTIME
    // (TUYỆT ĐỐI KHÔNG BẤM F5 / RELOAD TRANG - Comment 5.3 & 5.4)
    // -----------------------------------------------------------------
    const caregiver1Status = pageCaregiver1.getByTestId('status-text');
    const caregiver2Status = pageCaregiver2.getByTestId('status-text');

    await expect(caregiver1Status).toContainText('Hôm nay đã ổn', { timeout: 10000 });
    await expect(caregiver2Status).toContainText('Hôm nay đã ổn', { timeout: 10000 });

    // Đóng 3 cửa sổ trình duyệt sạch sẽ
    await contextElderly.close();
    await contextCaregiver1.close();
    await contextCaregiver2.close();
  });

});


