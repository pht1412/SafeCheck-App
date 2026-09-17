import React, { useState, useEffect, useId } from 'react';
import type { CheckinSchedule } from '../types';
import {
  checkinScheduleService,
  formatTimeDisplay,
  timeToSeconds,
} from '../services/checkinScheduleService';

interface ScheduleSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  elderlyId: string;
  elderlyName: string;
  currentSchedule?: CheckinSchedule | null;
  onScheduleUpdated: (updatedSchedule: CheckinSchedule) => void;
}

const BUFFER_OPTIONS = [
  { value: 15, label: '15 phút' },
  { value: 30, label: '30 phút (Khuyên dùng)' },
  { value: 45, label: '45 phút' },
  { value: 60, label: '60 phút' },
];

export const ScheduleSettingsModal: React.FC<ScheduleSettingsModalProps> = ({
  isOpen,
  onClose,
  elderlyId,
  elderlyName,
  currentSchedule,
  onScheduleUpdated,
}) => {
  const [startInput, setStartInput] = useState('07:00');
  const [deadlineInput, setDeadlineInput] = useState('09:00');
  const [bufferInput, setBufferInput] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const startInputId = useId();
  const deadlineInputId = useId();

  // Khởi tạo giá trị ban đầu từ schedule hiện hành
  useEffect(() => {
    if (currentSchedule) {
      setStartInput(formatTimeDisplay(currentSchedule.checkin_start));
      setDeadlineInput(formatTimeDisplay(currentSchedule.checkin_deadline));
      setBufferInput(currentSchedule.emergency_buffer_minutes || 30);
    }
    setErrorMessage(null);
    setSuccessToast(null);
  }, [currentSchedule, isOpen]);

  if (!isOpen) return null;

  // Tính toán thời điểm phát báo động khẩn cấp
  const startSec = timeToSeconds(startInput);
  const deadlineSec = timeToSeconds(deadlineInput);
  const emergencySec = deadlineSec + bufferInput * 60;

  const isInvalidRange = startSec >= deadlineSec;
  const isDayOverflow = emergencySec >= 86400;

  const formatSecToTime = (totalSec: number) => {
    const boundedSec = Math.min(Math.max(totalSec, 0), 86399);
    const h = Math.floor(boundedSec / 3600);
    const m = Math.floor((boundedSec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const emergencyTimeStr = formatSecToTime(emergencySec);

  // Tỷ lệ phần trăm trên thanh 24h để vẽ timeline
  const startPct = Math.min(100, Math.max(0, (startSec / 86400) * 100));
  const deadlinePct = Math.min(100, Math.max(0, (deadlineSec / 86400) * 100));
  const emergencyPct = Math.min(100, Math.max(0, (emergencySec / 86400) * 100));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (isInvalidRange) {
      setErrorMessage('Giờ bắt đầu phải diễn ra trước giờ hạn chót');
      return;
    }

    if (isDayOverflow) {
      setErrorMessage('Hạn chót cộng thời gian chờ không được vượt quá 23:59 trong ngày');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await checkinScheduleService.updateSchedule(
        elderlyId,
        startInput,
        deadlineInput,
        bufferInput
      );

      if (!res.success) {
        setErrorMessage(res.message || 'Không thể lưu cài đặt');
        setIsSubmitting(false);
        return;
      }

      setSuccessToast('Đã lưu khung giờ điểm danh thành công!');
      onScheduleUpdated({
        elderly_id: elderlyId,
        checkin_start: `${startInput}:00`,
        checkin_deadline: `${deadlineInput}:00`,
        emergency_buffer_minutes: bufferInput,
        timezone: 'Asia/Ho_Chi_Minh',
        is_active: true,
      });

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMessage(err.message || 'Đã xảy ra lỗi khi lưu');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="schedule-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in"
    >
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div>
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-semibold">
              Cài đặt gia đình
            </span>
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mt-0.5">
              <span>⏰</span> Khung giờ điểm danh ({elderlyName || 'Cụ'})
            </h2>
          </div>
          <button
            data-testid="btn-close-schedule-modal"
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-6">
          {/* Thông báo lỗi & thành công */}
          {errorMessage && (
            <div
              data-testid="schedule-error-message"
              className="p-3.5 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-300 text-xs font-semibold flex items-center gap-2"
            >
              <span>⚠️</span> {errorMessage}
            </div>
          )}

          {successToast && (
            <div
              data-testid="schedule-success-message"
              className="p-3.5 bg-emerald-950/80 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs font-semibold flex items-center gap-2"
            >
              <span>✅</span> {successToast}
            </div>
          )}

          {/* Hàng 2 ô nhập giờ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={startInputId}
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Giờ bắt đầu mở nút
              </label>
              <input
                id={startInputId}
                data-testid="input-checkin-start"
                type="time"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                required
                className="w-full bg-slate-800/90 border border-slate-700 rounded-2xl px-4 py-2.5 text-white text-base font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Trước giờ này nút điểm danh sẽ ở trạng thái chờ
              </span>
            </div>

            <div>
              <label
                htmlFor={deadlineInputId}
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Hạn chót đúng giờ
              </label>
              <input
                id={deadlineInputId}
                data-testid="input-checkin-deadline"
                type="time"
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
                required
                className="w-full bg-slate-800/90 border border-slate-700 rounded-2xl px-4 py-2.5 text-white text-base font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Sau mốc này sẽ báo trễ giờ (Cảnh báo vàng)
              </span>
            </div>
          </div>

          {/* Chọn thời gian ân hạn buffer */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Thời gian chờ trước khi báo động đỏ (Khẩn cấp)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BUFFER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`buffer-pill-${opt.value}`}
                  onClick={() => setBufferInput(opt.value)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all text-center ${
                    bufferInput === opt.value
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-md ring-1 ring-emerald-500/50'
                      : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Thanh Timeline 24h minh họa trực quan */}
          <div className="p-4 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-3">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block">
              Trực quan hóa nhịp sinh hoạt trong ngày
            </span>

            {/* Thanh thanh bar phân đoạn */}
            <div className="h-4 w-full bg-slate-800 rounded-full overflow-hidden flex relative ring-1 ring-white/5">
              {/* Vùng trước start: Xám */}
              <div
                style={{ width: `${startPct}%` }}
                className="h-full bg-slate-700/60"
                title="Chưa đến giờ"
              />
              {/* Vùng đúng giờ: Xanh lá */}
              <div
                style={{ width: `${Math.max(0, deadlinePct - startPct)}%` }}
                className="h-full bg-emerald-500"
                title="Khung giờ đúng hạn (Safe)"
              />
              {/* Vùng trễ giờ: Vàng cam */}
              <div
                style={{ width: `${Math.max(0, emergencyPct - deadlinePct)}%` }}
                className="h-full bg-amber-500"
                title="Trễ giờ (Late)"
              />
              {/* Vùng khẩn cấp: Đỏ */}
              <div
                style={{ width: `${Math.max(0, 100 - emergencyPct)}%` }}
                className="h-full bg-rose-600"
                title="Khẩn cấp (Emergency)"
              />
            </div>

            {/* Chú giải timeline */}
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] pt-1">
              <div className="p-2 bg-emerald-950/40 border border-emerald-500/20 rounded-xl">
                <span className="text-emerald-400 font-bold block">Đúng giờ</span>
                <span className="text-slate-300 text-[10px]">
                  {startInput} - {deadlineInput}
                </span>
              </div>
              <div className="p-2 bg-amber-950/40 border border-amber-500/20 rounded-xl">
                <span className="text-amber-400 font-bold block">Báo trễ (Vàng)</span>
                <span className="text-slate-300 text-[10px]">
                  {deadlineInput} - {emergencyTimeStr}
                </span>
              </div>
              <div className="p-2 bg-rose-950/40 border border-rose-500/20 rounded-xl">
                <span className="text-rose-400 font-bold block">Còi đỏ (SOS)</span>
                <span className="text-slate-300 text-[10px]">
                  Sau {emergencyTimeStr}
                </span>
              </div>
            </div>
          </div>

          {/* Nút hành động */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700/80 text-slate-300 font-semibold text-sm transition-all"
            >
              Hủy
            </button>
            <button
              data-testid="btn-save-schedule"
              type="submit"
              disabled={isSubmitting || isInvalidRange || isDayOverflow}
              className="flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <span>Lưu cài đặt</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
