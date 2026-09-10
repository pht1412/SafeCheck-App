import type { SystemState } from '../types';

interface ElderlyScreenProps {
  systemState: SystemState;
  checkInTime: string | null;
  batteryLevel: number;
  sosHolding: boolean;
  sosCountdown: number | null;
  elderlyName?: string;
  pairingCode?: string | null;
  hasLinkedCaregivers?: boolean;
  onCheckIn: () => void;
  onStartSosHold: () => void;
  onCancelSosHold: () => void;
  onAbortSosCountdown: () => void;
  onResolveAlarm: () => void;
}

export default function ElderlyScreen({
  systemState,
  checkInTime,
  batteryLevel,
  sosHolding,
  sosCountdown,
  elderlyName,
  pairingCode,
  hasLinkedCaregivers = false,
  onCheckIn,
  onStartSosHold,
  onCancelSosHold,
  onAbortSosCountdown,
  onResolveAlarm,
}: ElderlyScreenProps) {
  return (
    <div className="flex flex-col items-center w-full">
      <span className="hidden sm:block text-xs uppercase tracking-widest text-emerald-400 font-semibold mb-2">
        Màn hình Cụ (Elderly Phone)
      </span>
      <div
        data-testid="elderly-device"
        className="w-full sm:w-[390px] h-[100dvh] sm:h-[720px] bg-slate-950 sm:border-4 sm:border-slate-800 sm:rounded-[40px] shadow-2xl p-4 sm:p-6 flex flex-col justify-between relative overflow-hidden sm:ring-1 sm:ring-white/10"
      >
        <div className="flex justify-between items-center text-slate-400 text-xs pb-4 border-b border-slate-800/80">
          <div>
            <span className="font-bold text-white block text-sm">{elderlyName || 'Cụ Ba'}</span>
            {pairingCode && (
              <span className="text-[11px] text-emerald-400 font-mono tracking-wider block mt-0.5">
                Mã ghép: <strong data-testid="elderly-pairing-code" className="bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-300 font-black">{pairingCode}</strong>
              </span>
            )}
            <div className="mt-1">
              {hasLinkedCaregivers ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Đã kết nối người thân
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-semibold bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Chưa có người thân kết nối
                </span>
              )}
            </div>
          </div>
          <span>Pin: {batteryLevel}%</span>
        </div>

        {/* Cơ chế đếm ngược chống bấm nhầm 10 giây */}
        {sosCountdown !== null && (
          <div
            data-testid="sos-countdown-modal"
            className="absolute inset-0 z-50 bg-rose-950/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in"
          >
            <p className="text-rose-300 font-bold text-lg mb-2 uppercase tracking-wide">
              Chuẩn bị phát báo động!
            </p>
            <div className="text-7xl font-black text-white my-4 animate-ping">
              {sosCountdown}
            </div>
            <p className="text-slate-300 text-sm mb-6">
              Hệ thống sẽ hú còi và gọi cho con cháu sau {sosCountdown} giây nữa
            </p>
            <button
              data-testid="cancel-sos-button"
              onClick={onAbortSosCountdown}
              className="w-full py-5 bg-white text-rose-900 hover:bg-slate-100 rounded-3xl font-black text-2xl shadow-2xl active:scale-95 transition-all"
            >
              HỦY BÁO ĐỘNG
            </button>
          </div>
        )}

        {/* Phân tách giao diện màn hình Cụ theo trạng thái */}
        <div className="flex flex-col items-center justify-center my-auto w-full">
          {systemState === 'Emergency' ? (
            <div
              data-testid="elderly-emergency-view"
              className="w-full flex flex-col items-center gap-3 animate-in fade-in"
            >
              {hasLinkedCaregivers ? (
                /* TH1: Đã có con cháu liên kết */
                <div className="w-full bg-rose-950/90 border-4 border-rose-600 rounded-3xl p-5 text-center shadow-2xl">
                  <div className="text-5xl mb-2 animate-bounce">🚨</div>
                  <p className="text-white text-2xl font-black mb-1">ĐANG BÁO ĐỘNG ĐỎ</p>
                  <p className="text-rose-200 text-sm mb-3">
                    Đã phát còi và báo động khẩn cấp tới con cháu!
                  </p>

                  {/* Nút gọi khẩn cấp 115 - Luôn sẵn sàng kể cả khi đã có con cháu */}
                  <a
                    href="tel:115"
                    data-testid="elderly-call-115-btn"
                    className="w-full py-4 mb-3 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-xl rounded-2xl shadow-xl border-2 border-rose-300 flex items-center justify-center gap-2 transition-all block text-center ring-4 ring-rose-500/40 animate-pulse"
                  >
                    <span>📞 GỌI NGAY CẤP CỨU 115</span>
                  </a>

                  <button
                    data-testid="resolve-alarm-elderly-button"
                    onClick={onResolveAlarm}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-base rounded-2xl shadow-lg border-2 border-emerald-400 transition-all"
                  >
                    🟢 TÔI ĐÃ AN TOÀN (TẮT CÒI)
                  </button>
                </div>
              ) : (
                /* TH2: Phương án B - Chưa có con cháu nào liên kết */
                <div className="w-full bg-rose-950/95 border-4 border-rose-600 rounded-3xl p-5 text-center shadow-2xl">
                  <div className="text-5xl mb-2 animate-bounce">⚠️🚨</div>
                  <p className="text-white text-2xl font-black mb-1">ĐANG BÁO ĐỘNG ĐỎ</p>
                  <div className="bg-rose-900/60 border border-rose-500/50 rounded-xl p-2.5 my-2 text-rose-200 text-xs font-semibold">
                    ⚠️ Chưa có người thân nào kết nối với máy của Cụ!
                  </div>

                  {/* Nút gọi khẩn cấp 115 */}
                  <a
                    href="tel:115"
                    data-testid="elderly-call-115-btn"
                    className="w-full py-3.5 mb-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-lg rounded-2xl shadow-xl border-2 border-rose-300 flex items-center justify-center gap-2 transition-all block text-center"
                  >
                    <span>📞 GỌI NGAY CẤP CỨU 115</span>
                  </a>

                  {/* Nút tắt còi / xác nhận đã ổn */}
                  <button
                    data-testid="resolve-alarm-elderly-button"
                    onClick={onResolveAlarm}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-emerald-300 font-bold text-sm rounded-2xl border border-emerald-500/50 transition-all"
                  >
                    🟢 TÔI ĐÃ ỔN / TẮT CÒI
                  </button>
                </div>
              )}
            </div>
          ) : systemState === 'Safe' ? (
            <div
              data-testid="status-safe-card"
              className="w-full bg-emerald-950/40 border-2 border-emerald-500/50 rounded-3xl p-6 text-center shadow-lg"
            >
              <p className="text-emerald-400 text-2xl font-black mb-2">HÔM NAY ĐÃ ỔN</p>
              <p className="text-slate-300 text-base">
                Đã điểm danh lúc:{' '}
                <span className="font-bold text-white">
                  {checkInTime || 'Vừa xong'}
                </span>
              </p>
              <p className="text-slate-400 text-xs mt-3">Chúc cụ một ngày an lành!</p>
            </div>
          ) : systemState === 'Ping_Requested' ? (
            <div className="w-full flex flex-col items-center gap-4">
              <div
                data-testid="ping-alert"
                className="w-full bg-amber-500/20 border-2 border-amber-500 p-3 rounded-2xl animate-bounce text-center"
              >
                <p className="text-amber-300 font-black text-base">
                  Con cháu đang hỏi thăm!
                </p>
              </div>
              <button
                data-testid="checkin-button"
                onClick={onCheckIn}
                className="w-full h-44 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 text-2xl font-black rounded-3xl shadow-xl border-4 border-amber-300 transition-all flex flex-col items-center justify-center gap-2"
              >
                <span>BẤM ĐỂ CON YÊN TÂM</span>
                <span className="text-xs font-semibold opacity-90">
                  (Chạm 1 lần vào đây)
                </span>
              </button>
            </div>
          ) : (
            /* Trạng thái Waiting / Late */
            <button
              data-testid="checkin-button"
              onClick={onCheckIn}
              className="w-full h-48 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-3xl font-black rounded-3xl shadow-xl border-4 border-emerald-400 transition-all flex flex-col items-center justify-center gap-2"
            >
              <span>HÔM NAY</span>
              <span>TÔI ỔN</span>
              <span className="text-xs font-normal opacity-80">(Chạm 1 lần)</span>
            </button>
          )}
        </div>

        {/* Nút SOS nhấn giữ 3 giây */}
        <div className="w-full pt-4 border-t border-slate-800/80">
          <button
            data-testid="sos-button"
            disabled={systemState === 'Emergency'}
            onMouseDown={onStartSosHold}
            onMouseUp={onCancelSosHold}
            onTouchStart={onStartSosHold}
            onTouchEnd={onCancelSosHold}
            className={`w-full py-5 rounded-2xl text-xl font-black uppercase tracking-wider transition-all border-2 disabled:opacity-50 ${
              sosHolding
                ? 'bg-rose-700 border-white text-white animate-pulse'
                : 'bg-rose-950/40 border-rose-600/60 text-rose-400 hover:bg-rose-900/50'
            }`}
          >
            {sosHolding ? 'ĐANG GIỮ ĐỂ BÁO ĐỘNG...' : 'CẦN GIÚP ĐỠ (GIỮ 3 GIÂY)'}
          </button>
        </div>
      </div>
    </div>
  );
}
