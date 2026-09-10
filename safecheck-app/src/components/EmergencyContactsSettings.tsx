import React, { useState } from 'react';
import type { EmergencyContact, EmergencyContactCategory } from '../types';
import { emergencyContactsService } from '../services/emergencyContactsService';

interface EmergencyContactsSettingsProps {
  elderlyId: string;
  elderlyName: string;
  contacts: EmergencyContact[];
  onRefreshContacts: () => void;
  onClose?: () => void;
}

const CATEGORY_OPTIONS: { value: EmergencyContactCategory; label: string; icon: string }[] = [
  { value: 'neighbor', label: 'Hàng xóm lân cận', icon: '🏡' },
  { value: 'relative', label: 'Người thân trong nhà', icon: '👨‍👩‍👧' },
  { value: 'authority', label: 'Công an / Dân phòng phường', icon: '👮' },
  { value: 'medical', label: 'Trạm y tế / Bác sĩ', icon: '👨‍⚕️' },
  { value: 'other', label: 'Khác', icon: '🤝' },
];

export const EmergencyContactsSettings: React.FC<EmergencyContactsSettingsProps> = ({
  elderlyId,
  elderlyName,
  contacts,
  onRefreshContacts,
  onClose,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactType, setContactType] = useState<EmergencyContactCategory>('neighbor');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openCreateForm = () => {
    setEditingContact(null);
    setName('');
    setPhone('');
    setContactType('neighbor');
    setNote('');
    setErrorMessage(null);
    setIsFormOpen(true);
  };

  const openEditForm = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setContactType(contact.contact_type);
    setNote(contact.note || '');
    setErrorMessage(null);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Vui lòng nhập tên người liên hệ');
      return;
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!cleanPhone || cleanPhone.length < 3) {
      setErrorMessage('Số điện thoại không hợp lệ');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingContact) {
        // Cập nhật
        const { error } = await emergencyContactsService.updateContact(editingContact.id, {
          name,
          phone: cleanPhone,
          contact_type: contactType,
          note,
        });
        if (error) throw error;
      } else {
        // Tạo mới
        const { error } = await emergencyContactsService.createContact({
          elderly_id: elderlyId,
          name,
          phone: cleanPhone,
          contact_type: contactType,
          note,
        });
        if (error) throw error;
      }

      setIsFormOpen(false);
      onRefreshContacts();
    } catch (err: any) {
      console.error('Lỗi lưu liên hệ:', err);
      setErrorMessage(err.message || 'Không thể lưu liên hệ khẩn cấp');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (contact: EmergencyContact) => {
    if (!window.confirm(`Bạn có chắc muốn xóa "${contact.name}" khỏi danh bạ cứu hộ?`)) {
      return;
    }

    try {
      const { error } = await emergencyContactsService.deleteContact(contact.id);
      if (error) throw error;
      onRefreshContacts();
    } catch (err: any) {
      alert(`Lỗi khi xóa: ${err.message || 'Thao tác không thành công'}`);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl mb-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📇</span>
            <h3 className="text-sm font-black text-white uppercase tracking-wide">
              Danh Bạ Cứu Hộ Khẩn Cấp
            </h3>
          </div>
          <p className="text-[11px] text-slate-400">
            Dành cho <strong className="text-indigo-300">{elderlyName}</strong> (Tối đa 5 liên hệ)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="contacts-count-badge"
            className={`whitespace-nowrap inline-flex items-center text-[11px] px-2 py-0.5 rounded-full font-bold border ${contacts.length >= 5
              ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
              : 'bg-indigo-950/80 text-indigo-300 border-indigo-500/40'
              }`}
          >
            {contacts.length}/5
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold transition-all"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Nút Thêm mới */}
      <div className="mb-3">
        <button
          type="button"
          onClick={openCreateForm}
          disabled={contacts.length >= 5}
          data-testid="add-emergency-contact-btn"
          className="w-full py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 active:scale-98 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1.5"
        >
          <span>+ THÊM LIÊN HỆ CỨU HỘ</span>
          {contacts.length >= 5 && <span className="text-[10px]">(Đã đủ 5)</span>}
        </button>
      </div>

      {/* Danh sách liên hệ hiện có */}
      <div className="space-y-2">
        {contacts.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-400 bg-slate-950/50 rounded-xl border border-dashed border-slate-800 p-3">
            Chưa có số nào được lưu. Hãy thêm hàng xóm hoặc công an phường để kịp thời ứng cứu khi có sự cố!
          </div>
        ) : (
          contacts.map((contact) => {
            const meta =
              CATEGORY_OPTIONS.find((c) => c.value === contact.contact_type) || CATEGORY_OPTIONS[0];
            return (
              <div
                key={contact.id}
                data-testid={`contact-item-${contact.id}`}
                className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">{meta.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-white truncate max-w-[130px]">
                        {contact.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-semibold">
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-emerald-400 font-semibold">
                      {contact.phone}
                    </p>
                    {contact.note && (
                      <p className="text-[10px] text-slate-400 truncate max-w-[180px]">
                        {contact.note}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid={`edit-contact-${contact.id}`}
                    onClick={() => openEditForm(contact)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] rounded-lg font-bold transition-all"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    data-testid={`delete-contact-${contact.id}`}
                    onClick={() => handleDelete(contact)}
                    className="px-2 py-1 bg-slate-800 hover:bg-rose-900 text-rose-300 text-[11px] rounded-lg font-bold transition-all"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Form Modal Thêm / Sửa liên hệ */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-sm p-5 shadow-2xl animate-in zoom-in-95">
            <h4 className="text-sm font-black text-white uppercase tracking-wide mb-3">
              {editingContact ? 'Sửa liên hệ cứu hộ' : 'Thêm liên hệ cứu hộ mới'}
            </h4>

            {errorMessage && (
              <div className="p-2.5 mb-3 bg-rose-950/80 border border-rose-500 rounded-xl text-rose-200 text-xs font-semibold">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Tên liên hệ / Người hỗ trợ:
                </label>
                <input
                  type="text"
                  required
                  data-testid="contact-name-input"
                  placeholder="Ví dụ: Bác Tư (Hàng xóm sát nhà)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Số điện thoại:
                </label>
                <input
                  type="tel"
                  required
                  data-testid="contact-phone-input"
                  placeholder="Ví dụ: 0901234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Mối quan hệ / Phân loại:
                </label>
                <select
                  value={contactType}
                  data-testid="contact-type-select"
                  onChange={(e) => setContactType(e.target.value as EmergencyContactCategory)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.icon} {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Ghi chú (tùy chọn):
                </label>
                <input
                  type="text"
                  data-testid="contact-note-input"
                  placeholder="Ví dụ: Giữ chìa khóa cửa sau, có mặt sau 2p"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  data-testid="cancel-contact-btn"
                  onClick={() => setIsFormOpen(false)}
                  className="w-1/2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="save-contact-btn"
                  className="w-1/2 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Lưu lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
