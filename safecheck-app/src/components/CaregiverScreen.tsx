import { useState, useEffect } from 'react';
import type { SystemState, EmergencyContact } from '../types';
import type { ConnectionHealth } from '../hooks/useDeviceStatus';
import { EmergencyContactsModal } from './EmergencyContactsModal';
import { EmergencyContactsSettings } from './EmergencyContactsSettings';
import { emergencyContactsService } from '../services/emergencyContactsService';
import { pushNotificationService } from '../services/pushNotificationService';

interface LinkedElderly {
  id: string;
  full_name: string;
  pairing_code: string;
  phone?: string | null;
}

interface CaregiverScreenProps {
  systemState: SystemState;
  checkInTime: string | null;
  batteryLevel: number | null;
  isCharging?: boolean;
  connectionHealth?: ConnectionHealth;
  pingCooldown: number;
  isPingAllowed: boolean;
  isSirenMuted: boolean;
  caregiverName?: string;
  linkedElderly?: LinkedElderly | null;
  isTester?: boolean;
  conflictToast?: string | null;
  onSendPing: () => void;
  onResolveAlarm: () => void;
  onToggleMuteSiren: () => void;
  onManualStatus: (status: SystemState) => void;
  onSignOut?: () => void;
  onConnectFamily?: (pairingCode: string, relationship: string) => Promise<{ success: boolean; message: string }>;
}

export default function CaregiverScreen({
  systemState,
  checkInTime,
  batteryLevel,
  isCharging = false,
  connectionHealth = 'healthy',
  pingCooldown,
  isPingAllowed,
  isSirenMuted,
  caregiverName,
  linkedElderly,
  isTester = false,
  conflictToast,
  onSendPing,
  onResolveAlarm,
  onToggleMuteSiren,
  onManualStatus,
  onSignOut,
  onConnectFamily,
}: CaregiverScreenProps) {
  // State quản lý hộp thoại nhập mã kết nối
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [relationshipInput, setRelationshipInput] = useState('Con trai');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // State quản lý danh bạ cứu hộ
  const [isContactsModalOpen, setIsContactsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // State quản lý Web Push Notification
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [isPushSupported, setIsPushSupported] = useState<boolean>(false);
  const [isSubscribingPush, setIsSubscribingPush] = useState<boolean>(false);
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsPushSupported(pushNotificationService.isPushSupported());
    setPushPermission(pushNotificationService.getPermissionState());
  }, []);

  const handleEnablePush = async () => {
    setIsSubscribingPush(true);
    setPushStatusMessage(null);
    const res = await pushNotificationService.subscribeToPush();
    setPushPermission(pushNotificationService.getPermissionState());
    setPushStatusMessage(res.message);
    setIsSubscribingPush(false);
  };

  const loadContacts = async () => {
    if (!linkedElderly?.id) {
      setEmergencyContacts([]);
      return;
    }
    setIsLoadingContacts(true);
    try {
      const { data } = await emergencyContactsService.getContactsByElderlyId(linkedElderly.id);
      setEmergencyContacts(data || []);
    } catch (err) {
      console.error('Lỗi tải danh bạ cứu hộ:', err);
    } finally {
      setIsLoadingContacts(false);
    }
  };

  useEffect(() => {
    loadContacts();
    if (typeof window !== 'undefined') {
      (window as any).__safecheck = {
        emergencyContactsService,
        elderlyId: linkedElderly?.id,
      };
    }
  }, [linkedElderly?.id]);

  const elderlyName = linkedElderly?.full_name || 'Người thân';

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onConnectFamily) return;
    setConnectError(null);
    setIsSubmitting(true);

    try {
      const res = await onConnectFamily(pairingCodeInput.trim(), relationshipInput);
      if (!res.success) {
        setConnectError(res.message);
      } else {
        setIsConnectModalOpen(false);
        setPairingCodeInput('');
      }
    } catch (err: any) {
      setConnectError(err.message || 'Lỗi kết nối');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full">
      <span className="hidden sm:block text-xs uppercase tracking-widest text-indigo-400 font-semibold mb-2">
        Màn hình Con cháu (Dashboard)
      </span>
      <div
        data-testid="caregiver-device"
        className="w-full sm:w-[390px] h-[100dvh] sm:h-[720px] bg-slate-950 sm:border-4 sm:border-slate-800 sm:rounded-[40px] shadow-2xl p-4 sm:p-6 flex flex-col justify-between sm:ring-1 sm:ring-white/10 relative overflow-y-auto [&::-webkit-scrollbar]:hidden"
      >
        <div>
          {/* Thanh thông tin người dùng và Đăng xuất */}
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800/80 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block">Đang đăng nhập:</span>
              <span className="font-bold text-white">{caregiverName || 'Con cháu'}</span>
            </div>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="text-[11px] bg-slate-800 hover:bg-slate-700 active:scale-95 text-rose-300 px-2.5 py-1 rounded-xl transition-all border border-slate-700"
              >
                Đăng xuất
              </button>
            )}
          </div>

          {/* TRƯỜNG HỢP 1: CHƯA KẾT NỐI VỚI CỤ NÀO */}
          {!linkedElderly ? (
            <div className="my-auto py-12 px-2 text-center flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-slate-900 border-2 border-slate-800 rounded-3xl flex items-center justify-center text-4xl mb-4 shadow-inner">
                🔗
              </div>
              <h3 className="text-lg font-black text-white mb-2">Chưa kết nối người thân</h3>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                Bạn chưa kết nối với tài khoản Cụ nào. Hãy nhập <strong>Mã ghép nối (6 ký tự)</strong> hiển thị trên màn hình của Cụ để bắt đầu theo dõi.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsConnectModalOpen(true);
                  setConnectError(null);
                }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white font-black text-sm rounded-2xl shadow-xl shadow-indigo-950/50 transition-all flex items-center justify-center gap-2"
              >
                <span>+ KẾT NỐI VỚI CỤ NGAY</span>
              </button>
            </div>
          ) : (
            /* TRƯỜNG HỢP 2: ĐÃ KẾT NỐI VỚI CỤ */
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <span className="text-[10px] text-slate-400 block">Đang theo dõi:</span>
                  <h2 className="text-base font-black text-white">{linkedElderly.full_name}</h2>
                </div>
                <span className="text-xs px-2.5 py-1 bg-emerald-950/80 border border-emerald-500/40 rounded-full text-emerald-400 font-bold">
                  Đã kết nối
                </span>
              </div>

              <div
                data-testid="caregiver-status-badge"
                className={`p-4 rounded-2xl border text-center mb-4 transition-colors ${systemState === 'Safe'
                  ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                  : systemState === 'Waiting'
                    ? 'bg-slate-900 border-slate-700 text-slate-300'
                    : systemState === 'Late' || systemState === 'Overdue_Ping'
                      ? 'bg-amber-950/30 border-amber-500 text-amber-300'
                      : systemState === 'Emergency'
                        ? 'bg-rose-950 border-rose-500 text-rose-200 animate-pulse'
                        : 'bg-indigo-950/30 border-indigo-500 text-indigo-300'
                  }`}
              >
                <p className="text-xs uppercase font-semibold tracking-wider text-slate-400">
                  Trạng thái hiện tại
                </p>
                <p className="text-2xl font-black mt-1" data-testid="status-text">
                  {systemState === 'Safe' && '🟢 Hôm nay đã ổn'}
                  {systemState === 'Waiting' && `⚪ Chờ ${elderlyName} điểm danh`}
                  {systemState === 'Late' && '🟡 Trễ giờ điểm danh'}
                  {systemState === 'Ping_Requested' && '🔔 Đang gửi chuông hỏi thăm'}
                  {systemState === 'Overdue_Ping' && `⚠️ ${elderlyName} chưa phản hồi chuông`}
                  {systemState === 'Emergency' && '🚨 BÁO ĐỘNG KHẨN CẤP!'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {systemState === 'Safe' && (checkInTime ? `${elderlyName} đã điểm danh lúc ${checkInTime}` : `${elderlyName} đã xác nhận an toàn hôm nay`)}
                  {systemState === 'Waiting' && `Đang đợi ${elderlyName} bấm điểm danh buổi sáng`}
                  {systemState === 'Late' && 'Đã quá khung giờ điểm danh thường ngày'}
                  {systemState === 'Ping_Requested' && `Chuông đang reo trên điện thoại của ${elderlyName}`}
                  {systemState === 'Overdue_Ping' && `Đã gửi chuông nhưng chưa thấy ${elderlyName} chạm máy`}
                  {systemState === 'Emergency' && `${elderlyName} cần sự hỗ trợ ngay lập tức!`}
                </p>
              </div>

              {/* Banner Báo động khẩn cấp nổi bật kèm nút Gọi điện và Tắt/Bật còi */}
              {systemState === 'Emergency' && (
                <div
                  data-testid="caregiver-emergency-alert"
                  className="mb-4 bg-rose-950 border-2 border-rose-500 rounded-2xl p-4 text-center ring-4 ring-rose-500/30 animate-pulse"
                >
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-2xl animate-bounce">🚨</span>
                    <h3 className="text-rose-200 font-black text-base uppercase tracking-wide">
                      BÁO ĐỘNG KHẨN CẤP TỪ {elderlyName.toUpperCase()}!
                    </h3>
                  </div>
                  <p className="text-rose-300 text-xs mb-3 font-medium">
                    {elderlyName} vừa kích hoạt SOS cần sự giúp đỡ ngay lập tức!
                  </p>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      data-testid="open-emergency-directory-btn"
                      onClick={() => setIsContactsModalOpen(true)}
                      className="w-full py-3.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-xl ring-2 ring-rose-300 transition-all animate-pulse"
                    >
                      <span>🚨 MỞ DANH BẠ CỨU HỘ KHẨN CẤP</span>
                    </button>
                    <button
                      onClick={onToggleMuteSiren}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs text-slate-200 rounded-lg font-bold transition-all flex items-center justify-center gap-1 border border-slate-700"
                    >
                      <span>
                        {isSirenMuted ? '🔊 BẬT LẠI TIẾNG CÒI' : '🔇 TẮT TIẾNG CÒI HÚ'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Card Quản lý Cảnh báo Nền Web Push */}
              <div
                data-testid="push-notification-card"
                className="mb-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 text-xs shadow-md"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <span>🔔</span>
                    <span>Cảnh báo nền khi tắt app</span>
                  </span>
                  {pushPermission === 'granted' ? (
                    <span
                      data-testid="push-granted-badge"
                      className="px-2 py-0.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold rounded-full flex items-center gap-1"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Đã bật
                    </span>
                  ) : pushPermission === 'denied' ? (
                    <span
                      data-testid="push-denied-badge"
                      className="px-2 py-0.5 bg-rose-950/80 border border-rose-500/40 text-rose-300 text-[10px] font-bold rounded-full"
                    >
                      Bị chặn
                    </span>
                  ) : (
                    <span
                      data-testid="push-default-badge"
                      className="px-2 py-0.5 bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[10px] font-bold rounded-full"
                    >
                      Chưa bật
                    </span>
                  )}
                </div>

                {!isPushSupported ? (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    💡 Trình duyệt hiện tại chưa hỗ trợ Web Push. Trên iPhone, vui lòng bấm <strong>Chia sẻ &gt; Thêm vào MH chính</strong> để kích hoạt tính năng này.
                  </p>
                ) : pushPermission === 'granted' ? (
                  <div className="space-y-2">
                    {/* Thẻ trạng thái chuẩn mực ngữ nghĩa: KHÔNG dùng '24/7' hay 'Hệ thống bảo vệ' */}
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-3 shadow-sm">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-base shrink-0">
                        🛡️
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span className="text-xs font-bold text-emerald-300">Thiết bị đã bật cảnh báo nền</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">
                          Sẵn sàng tiếp nhận tín hiệu SOS từ {elderlyName} khi có sự cố
                        </p>
                      </div>
                    </div>

                    {/* Nút test kiểm thử: ĐẶC BIỆT KHÓA CHẶT, CHỈ HIỂN THỊ KHI LÀ TESTER (test01@gmail.com) */}
                    {isTester && (
                      <div className="pt-1">
                        <button
                          type="button"
                          data-testid="test-push-btn"
                          onClick={async () => {
                            setPushStatusMessage('Đang phát chuông thử nghiệm...');
                            const res = await pushNotificationService.testLocalNotification();
                            setPushStatusMessage(res.message);
                          }}
                          className="w-full py-2 bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-indigo-300 font-mono text-[10px] rounded-xl border border-indigo-500/30 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <span>🧪 [Tester] Bấm gửi thử 1 chuông thông báo</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : pushPermission === 'denied' ? (
                  <p className="text-[11px] text-rose-300/90 leading-relaxed">
                    ⚠️ Thông báo đang bị chặn. Vui lòng mở <strong>Cài đặt iPhone &gt; Safari &gt; Thông báo</strong> để bật lại cho SafeCheck.
                  </p>
                ) : (
                  <div>
                    <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                      Nhận chuông báo động đỏ trên màn hình khóa khi {elderlyName} gặp sự cố, kể cả khi bạn đã khóa màn hình.
                    </p>
                    <button
                      type="button"
                      data-testid="enable-push-btn"
                      onClick={handleEnablePush}
                      disabled={isSubscribingPush}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-950/50 flex items-center justify-center gap-1.5"
                    >
                      <span>{isSubscribingPush ? 'Đang kích hoạt...' : '🔔 BẬT CẢNH BÁO NỀN KHI TẮT APP'}</span>
                    </button>
                  </div>
                )}

                {pushStatusMessage && (
                  <p className="text-[10px] text-indigo-300 mt-2 text-center animate-pulse">
                    {pushStatusMessage}
                  </p>
                )}
              </div>

              <div className="bg-slate-900/90 rounded-2xl p-3 mb-4 flex justify-around items-center text-xs text-slate-300 border border-slate-800 shadow-inner">
                {/* Pin cục bộ con cháu - Minh bạch nguồn gốc, không fake thông tin */}
                <div className="flex items-center gap-1.5">
                  <span>{isCharging ? '⚡' : '🔋'}</span>
                  <span>Pin:</span>
                  <strong className={batteryLevel !== null && batteryLevel <= 20 ? "text-rose-400 font-bold animate-pulse" : "text-white font-bold"}>
                    {batteryLevel !== null ? `${batteryLevel}%` : 'Không khả dụng (iOS)'}
                  </strong>
                </div>

                <div className="text-slate-700">|</div>

                {/* Trạng thái kết nối suy luận từ ConnectionHealth */}
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${connectionHealth === 'healthy'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                      : connectionHealth === 'connecting'
                        ? 'bg-amber-400 animate-ping'
                        : connectionHealth === 'reconnecting'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-rose-500 animate-pulse'
                    }`} />
                  <span>Kết nối:</span>
                  <strong className={
                    connectionHealth === 'healthy'
                      ? 'text-emerald-400 font-bold'
                      : connectionHealth === 'connecting'
                        ? 'text-amber-400 font-bold'
                        : connectionHealth === 'reconnecting'
                          ? 'text-amber-500 font-bold'
                          : 'text-rose-400 font-bold'
                  }>
                    {connectionHealth === 'healthy'
                      ? 'Đã kết nối'
                      : connectionHealth === 'connecting'
                        ? 'Đang kết nối...'
                        : connectionHealth === 'reconnecting'
                          ? 'Đang kết nối lại'
                          : 'Mất mạng (Offline)'}
                  </strong>
                </div>
              </div>

              {/* Nút bật/tắt quản lý danh bạ cứu hộ */}
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  data-testid="toggle-contacts-settings-btn"
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-300 rounded-2xl text-xs font-bold flex items-center justify-between transition-all shadow-md"
                >
                  <span className="flex items-center gap-2">
                    <span>📇</span>
                    <span>Cài đặt Danh bạ Cứu hộ</span>
                  </span>
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                    {emergencyContacts.length}/5 số {isSettingsOpen ? '▲' : '▼'}
                  </span>
                </button>

                {isSettingsOpen && (
                  <div className="mt-3 animate-in fade-in">
                    <EmergencyContactsSettings
                      elderlyId={linkedElderly.id}
                      elderlyName={linkedElderly.full_name}
                      contacts={emergencyContacts}
                      onRefreshContacts={loadContacts}
                      onClose={() => setIsSettingsOpen(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Nút hành động ở đáy (chỉ hiện khi đã kết nối) */}
        {linkedElderly && (
          <div className="space-y-3 pt-4 shrink-0">
            {conflictToast && (
              <div
                data-testid="conflict-toast"
                className="bg-sky-950/90 border border-sky-500/60 text-sky-200 text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-2 animate-in fade-in shadow-lg"
              >
                <span className="text-base">ℹ️</span>
                <span className="font-medium">{conflictToast}</span>
              </div>
            )}
            <button
              data-testid="send-ping-button"
              onClick={onSendPing}
              disabled={!isPingAllowed || pingCooldown > 0}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-sm transition-all"
            >
              {pingCooldown > 0
                ? `Chờ thử lại (${pingCooldown}s)`
                : !isPingAllowed
                  ? 'Không thể Ping lúc này'
                  : 'Gửi chuông kiểm tra (Ping)'}
            </button>

            {(systemState === 'Emergency' ||
              systemState === 'Overdue_Ping' ||
              systemState === 'Late') && (
                <button
                  data-testid="resolve-alarm-button"
                  onClick={onResolveAlarm}
                  className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm"
                >
                  Xác nhận an toàn / Tắt báo động
                </button>
              )}

            {/* Dev tool chỉ hiển thị cho tài khoản tester (test01@gmail.com) */}
            {isTester && (
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[10px] text-amber-400 font-mono uppercase tracking-wider block mb-1">
                  🛠️ Mô phỏng trạng thái (Dev Tool):
                </span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() => onManualStatus('Late')}
                    className="text-[11px] bg-slate-800 hover:bg-slate-700 py-1.5 rounded text-slate-300"
                  >
                    Set Late
                  </button>
                  <button
                    onClick={() => onManualStatus('Emergency')}
                    className="text-[11px] bg-slate-800 hover:bg-slate-700 py-1.5 rounded text-slate-300"
                  >
                    Set SOS
                  </button>
                  <button
                    onClick={() => onManualStatus('Waiting')}
                    className="text-[11px] bg-slate-800 hover:bg-slate-700 py-1.5 rounded text-slate-300"
                  >
                    Set Waiting
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODAL NHẬP MÃ KẾT NỐI VỚI CỤ */}
        {isConnectModalOpen && (
          <div className="absolute inset-0 z-50 bg-slate-950/95 p-6 flex flex-col justify-center animate-in fade-in">
            <h3 className="text-xl font-black text-white text-center mb-1">Kết nối với Cụ</h3>
            <p className="text-xs text-slate-400 text-center mb-5">
              Nhập mã gồm 6 ký tự hiển thị ở góc trên màn hình của Cụ.
            </p>

            {connectError && (
              <div className="mb-4 bg-rose-950 border border-rose-600 p-3 rounded-xl text-xs text-rose-200">
                {connectError}
              </div>
            )}

            <form onSubmit={handleConnectSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Mã ghép nối (6 ký tự):
                </label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={pairingCodeInput}
                  onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                  placeholder="Ví dụ: 8B29JG"
                  className="w-full h-14 bg-slate-900 border-2 border-indigo-500/50 rounded-2xl px-4 text-center text-2xl font-mono font-black text-indigo-300 tracking-widest focus:outline-none focus:border-indigo-400 uppercase"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Mối quan hệ với Cụ:
                </label>
                <select
                  value={relationshipInput}
                  onChange={(e) => setRelationshipInput(e.target.value)}
                  className="w-full h-12 bg-slate-900 border border-slate-800 rounded-2xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="Con trai">Con trai</option>
                  <option value="Con gái">Con gái</option>
                  <option value="Con dâu / Con rể">Con dâu / Con rể</option>
                  <option value="Cháu">Cháu</option>
                  <option value="Hàng xóm / Người hỗ trợ">Hàng xóm / Người hỗ trợ</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang kết nối...' : 'Xác nhận'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Modal Danh bạ Cứu hộ Khẩn cấp (READ + CALL ONLY) */}
        <EmergencyContactsModal
          isOpen={isContactsModalOpen}
          onClose={() => setIsContactsModalOpen(false)}
          linkedElderly={
            linkedElderly
              ? ({
                id: linkedElderly.id,
                full_name: linkedElderly.full_name,
                pairing_code: linkedElderly.pairing_code,
                phone: linkedElderly.phone || null,
                role: 'elderly',
                avatar_url: null,
                email: null,
              } as any)
              : null
          }
          contacts={emergencyContacts}
          isLoading={isLoadingContacts}
        />

      </div>
    </div>
  );
}
