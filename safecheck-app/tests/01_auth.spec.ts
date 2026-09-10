import { test, expect } from '@playwright/test';

// test.describe dùng để gom nhóm các testcase có cùng chủ đề
test.describe('Module 01: Xác thực & Phân quyền Người dùng (Auth Flow)', () => {

    // beforeEach: Hành động chạy trước TẤT CẢ các testcase bên dưới
    test.beforeEach(async ({ page }) => {
        // Robot mở trình duyệt và truy cập vào trang chủ http://localhost:5173
        await page.goto('/');
    });

    // ===================================================================
    // TEST CASE 1: Kiểm tra giao diện khi mới vào app
    // ===================================================================
    test('TC01: Màn hình ban đầu hiển thị đúng Logo SafeCheck và Form Đăng nhập', async ({ page }) => {
        // 1. Kiểm tra xem tiêu đề h1 có tên 'SafeCheck' có xuất hiện không
        const title = page.getByRole('heading', { name: 'SafeCheck' });
        await expect(title).toBeVisible();

        // 2. Kiểm tra tab "Đăng nhập" (dùng exact: true để phân biệt với nút "ĐĂNG NHẬP" in hoa)
        const signinTab = page.getByRole('button', { name: 'Đăng nhập', exact: true });
        await expect(signinTab).toBeVisible();

        // 3. Kiểm tra các ô input có hiển thị đúng placeholder gợi ý không
        const identifierInput = page.getByPlaceholder('0901234567 hoặc conchau@gmail.com');
        const passwordInput = page.getByPlaceholder('Tối thiểu 6 ký tự');
        await expect(identifierInput).toBeVisible();
        await expect(passwordInput).toBeVisible();

        // 4. Kiểm tra nút submit màu xanh "ĐĂNG NHẬP" (in hoa)
        const submitBtn = page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true });
        await expect(submitBtn).toBeVisible();
    });

    // ===================================================================
    // TEST CASE 2: Kiểm tra việc chuyển tab sang "Tạo tài khoản mới"
    // ===================================================================
    test('TC02: Chuyển sang tab Tạo tài khoản hiển thị đủ 2 Role (Ông/Bà & Con cháu)', async ({ page }) => {
        // 1. Robot bấm chuột vào tab "Tạo tài khoản mới"
        const signupTab = page.getByRole('button', { name: 'Tạo tài khoản mới' });
        await signupTab.click();

        // 2. Kiểm tra xem 2 nút chọn vai trò có hiện lên không
        const elderlyRoleBtn = page.getByRole('button', { name: /Ông \/ Bà/ });
        const caregiverRoleBtn = page.getByRole('button', { name: /Con cháu/ });
        await expect(elderlyRoleBtn).toBeVisible();
        await expect(caregiverRoleBtn).toBeVisible();

        // 3. Mặc định Cụ được chọn -> Kiểm tra ô nhập "Tên gọi của Cụ" và "Số điện thoại của Cụ"
        const nameInput = page.getByPlaceholder('Ví dụ: Cụ Ba, Bà Ngoại');
        const phoneInput = page.getByPlaceholder('Ví dụ: 0901234567');
        await expect(nameInput).toBeVisible();
        await expect(phoneInput).toBeVisible();

        // 4. Nút bấm to ở dưới phải đổi chữ thành "HOÀN TẤT ĐĂNG KÝ"
        const submitBtn = page.getByRole('button', { name: 'HOÀN TẤT ĐĂNG KÝ' });
        await expect(submitBtn).toBeVisible();
    });

    // ===================================================================
    // TEST CASE 3: Kiểm tra thông báo lỗi khi nhập mật khẩu quá ngắn
    // ===================================================================
    test('TC03: Bắt lỗi khi nhập mật khẩu quá ngắn (< 6 ký tự)', async ({ page }) => {
        // 1. Chuyển sang tab Tạo tài khoản mới
        await page.getByRole('button', { name: 'Tạo tài khoản mới' }).click();

        // 2. Điền tên và số điện thoại, nhưng mật khẩu cố tình gõ chỉ có 3 số "123"
        await page.getByPlaceholder('Ví dụ: Cụ Ba, Bà Ngoại').fill('Cụ Bảy');
        await page.getByPlaceholder('Ví dụ: 0901234567').fill('0909999888');
        await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123');

        // 3. Robot bấm nút "HOÀN TẤT ĐĂNG KÝ"
        await page.getByRole('button', { name: 'HOÀN TẤT ĐĂNG KÝ' }).click();

        // 4. Kiểm chứng xem thông báo lỗi màu đỏ có xuất hiện trên màn hình không
        const errorAlert = page.getByText('Mật khẩu phải có ít nhất 6 ký tự');
        await expect(errorAlert).toBeVisible();
    });

    // ===================================================================
    // TEST CASE 4: Đăng ký thành công tài khoản Cụ và nhận Mã ghép nối
    // ===================================================================
    test('TC04: Đăng ký thành công tài khoản Cụ -> Cấp Mã ghép nối 6 ký tự', async ({ page }) => {
        // Sinh số điện thoại ngẫu nhiên để mỗi lần chạy test là một tài khoản mới tinh
        const randomPhone = '09' + Math.floor(10000000 + Math.random() * 90000000);

        // 1. Chuyển sang tab Tạo tài khoản mới
        await page.getByRole('button', { name: 'Tạo tài khoản mới' }).click();

        // 2. Điền thông tin chuẩn xác
        await page.getByPlaceholder('Ví dụ: Cụ Ba, Bà Ngoại').fill('Bà Bảy Kiểm Thử');
        await page.getByPlaceholder('Ví dụ: 0901234567').fill(randomPhone);
        await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');

        // 3. Robot bấm nút "HOÀN TẤT ĐĂNG KÝ"
        await page.getByRole('button', { name: 'HOÀN TẤT ĐĂNG KÝ' }).click();

        // 4. Kiểm chứng: Sau khi đăng ký xong, ứng dụng phải tự chuyển sang màn hình Cụ
        // Tên Cụ phải xuất hiện (cho phép chờ tối đa 10 giây để Supabase xử lý)
        await expect(page.getByText('Bà Bảy Kiểm Thử')).toBeVisible({ timeout: 10000 });

        // Dòng chữ "Mã ghép:" phải xuất hiện
        await expect(page.getByText('Mã ghép:')).toBeVisible();

        // Nút "HÔM NAY TÔI ỔN" phải sẵn sàng để Cụ điểm danh
        const checkinBtn = page.getByTestId('checkin-button');
        await expect(checkinBtn).toBeVisible();
    });

    // ===================================================================
    // TEST CASE 5: Đăng ký thành công tài khoản Con cháu (Caregiver Signup Flow)
    // ===================================================================
    test('TC05: Đăng ký thành công tài khoản Con cháu -> Dashboard màn hình trống', async ({ page }) => {
        // Sinh email ngẫu nhiên đảm bảo tuyệt đối không trùng lặp (Comment 3.1)
        const randomEmail = `conchau_${Date.now()}_${Math.random().toString(36).slice(2)}@gmail.com`;

        // 1. Chuyển sang tab Tạo tài khoản mới
        await page.getByRole('button', { name: 'Tạo tài khoản mới' }).click();

        // 2. Chọn vai trò "Con cháu"
        const caregiverRoleBtn = page.getByTestId('role-caregiver-btn');
        await caregiverRoleBtn.click();

        // 3. Điền thông tin đăng ký
        await page.getByTestId('auth-fullname-input').fill('Nguyễn Văn Con Trưởng');
        await page.getByTestId('auth-identifier-input').fill(randomEmail);
        await page.getByTestId('auth-password-input').fill('123456');

        // 4. Bấm HOÀN TẤT ĐĂNG KÝ
        await page.getByTestId('auth-submit-btn').click();

        // 5. Kiểm chứng chuyển hướng đúng role caregiver (Comment 3.2):
        // Header xuất hiện nút "Đăng xuất"
        await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

        // Màn hình hiển thị trạng thái chưa kết nối người thân (Comment 3.3)
        await expect(page.getByText('Chưa kết nối người thân')).toBeVisible();

        // Phải có nút kết nối với Cụ
        const connectBtn = page.getByRole('button', { name: '+ KẾT NỐI VỚI CỤ NGAY' });
        await expect(connectBtn).toBeVisible();
    });

    // ===================================================================
    // TEST CASE 6: Đăng nhập thất bại khi sai tài khoản hoặc mật khẩu (Negative Test)
    // ===================================================================
    test('TC06: Đăng nhập thất bại với tài khoản không tồn tại -> Báo lỗi, không crash', async ({ page }) => {
        // Identifier chắc chắn không tồn tại trong CSDL (Comment 4.2)
        const nonExistentEmail = `user_khong_ton_tai_${Date.now()}@gmail.com`;

        // 1. Nhập tài khoản và mật khẩu sai
        await page.getByTestId('auth-identifier-input').fill(nonExistentEmail);
        await page.getByTestId('auth-password-input').fill('wrongpass123');

        // 2. Bấm ĐĂNG NHẬP
        await page.getByTestId('auth-submit-btn').click();

        // 3. Kiểm chứng cảnh báo lỗi xuất hiện (Comment 4.1)
        const errorAlert = page.getByTestId('auth-error-alert');
        await expect(errorAlert).toBeVisible({ timeout: 10000 });

        // 4. Kiểm chứng người dùng vẫn ở AuthScreen, KHÔNG vào được Dashboard
        await expect(page.getByRole('button', { name: 'Đăng xuất' })).not.toBeVisible();
        await expect(page.getByTestId('auth-submit-btn')).toBeVisible();
    });

});