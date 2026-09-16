import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import type { SystemState, UserProfile } from './types';
import { SirenPlayer, playChimeSound } from './utils/sirenPlayer';
import { authService } from './services/authService';
import { pushNotificationService } from './services/pushNotificationService';
import { offlineQueueService } from './services/offlineQueueService';
import ElderlyScreen from './components/ElderlyScreen';
import CaregiverScreen from './components/CaregiverScreen';
import AuthScreen from './components/AuthScreen';
import { useDeviceStatus, deriveConnectionHealth, type RealtimeStatus } from './hooks/useDeviceStatus';

interface LinkedElderly {
  id: string;
  full_name: string;
  pairing_code: string;
  phone?: string | null;
}

export default function App() {
  // Quản lý phiên đăng nhập và hồ sơ người dùng
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  // Người lớn tuổi được kết nối với Con cháu
  const [linkedElderly, setLinkedElderly] = useState<LinkedElderly | null>(null);

  // States quản lý trạng thái nghiệp vụ SafeCheck
  const [systemState, setSystemState] = useState<SystemState>('Waiting');
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [pingCooldown, setPingCooldown] = useState<number>(0);
  const { batteryLevel, isCharging, networkStatus } = useDeviceStatus();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // States quản lý quy trình SOS chống bấm nhầm
  const [sosHolding, setSosHolding] = useState<boolean>(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);

  // States quản lý Concurrency & Offline Resilience
  const [activeSosEventId, setActiveSosEventId] = useState<string | null>(null);
  const [conflictToast, setConflictToast] = useState<string | null>(null);
  const [sosStartTime, setSosStartTime] = useState<number | null>(null);
  const [hasServerAck, setHasServerAck] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const [primaryCaregiver, setPrimaryCaregiver] = useState<{ name: string; phone: string } | null>(null);

  const sosHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosCountdownIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sirenRef = useRef<SirenPlayer | null>(null);

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  // Tiện ích đa giác quan: Rung và Giọng nói tiếng Việt
  const triggerSensoryFeedback = (message: string) => {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'vi-VN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  // 1. Kiểm tra Session tự động (Persistent Session)
  useEffect(() => {
    async function checkAuthSession() {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.fetchProfile(session.user.id);
          setUserProfile(profile);
        }
      } catch (err) {
        console.error('Lỗi kiểm tra phiên đăng nhập:', err);
      } finally {
        setIsAuthChecking(false);
      }
    }

    checkAuthSession();

    // Lắng nghe sự kiện đăng nhập / đăng xuất
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setUserProfile(null);
          setLinkedElderly(null);
        } else if (session?.user && !userProfile) {
          const profile = await authService.fetchProfile(session.user.id);
          setUserProfile(profile);
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // 1b. Kiểm tra Deep-link SOS từ Web Push Notification (?sos=<sos_event_id>)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const sosId = urlParams.get('sos');
    if (sosId) {
      supabase
        .from('sos_events')
        .select('*')
        .eq('id', sosId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && data.status === 'active') {
            console.log('[SafeCheck Deep-Link] Kích hoạt sự kiện khẩn cấp từ URL:', sosId);
            setSystemState('Emergency');
            setIsSirenMuted(false);
          }
        });
    }
  }, []);

  // 2. Nếu là Con cháu (caregiver): Tìm Cụ đã liên kết trong family_links
  const fetchLinkedElderly = async (caregiverId: string) => {
    try {
      const { data } = await supabase
        .from('family_links')
        .select('elderly_id, relationship, profiles!elderly_id(id, full_name, pairing_code, phone)')
        .eq('caregiver_id', caregiverId)
        .eq('status', 'accepted')
        .maybeSingle();

      if (data && data.profiles) {
        setLinkedElderly(data.profiles as unknown as LinkedElderly);
      } else {
        setLinkedElderly(null);
      }
    } catch (err) {
      console.error('Lỗi lấy thông tin liên kết gia đình:', err);
      setLinkedElderly(null);
    }
  };

  const [hasLinkedCaregivers, setHasLinkedCaregivers] = useState<boolean>(false);

  // 2b. Nếu là Cụ (elderly): Kiểm tra xem đã có người thân nào liên kết chưa
  const fetchElderlyCaregivers = async (elderlyId: string) => {
    try {
      const { data, count, error } = await supabase
        .from('family_links')
        .select('caregiver_id, profiles!caregiver_id(full_name, phone)', { count: 'exact' })
        .eq('elderly_id', elderlyId)
        .eq('status', 'accepted');

      if (!error && count !== null) {
        setHasLinkedCaregivers(count > 0);
        if (data && data.length > 0 && data[0].profiles) {
          const prof = data[0].profiles as any;
          setPrimaryCaregiver({
            name: prof.full_name || 'Con cháu',
            phone: prof.phone || '0901234567',
          });
        }
      }
    } catch (err) {
      console.error('Lỗi kiểm tra người thân liên kết:', err);
    }
  };

  useEffect(() => {
    if (userProfile?.role === 'caregiver') {
      fetchLinkedElderly(userProfile.id);
    } else if (userProfile?.role === 'elderly') {
      setLinkedElderly(null);
      fetchElderlyCaregivers(userProfile.id);

      // Lắng nghe Realtime xem có con cháu nào vừa kết nối không
      const linkChannel = supabase
        .channel(`family-links-${userProfile.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'family_links',
            filter: `elderly_id=eq.${userProfile.id}`,
          },
          () => {
            fetchElderlyCaregivers(userProfile.id);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(linkChannel);
      };
    } else {
      setLinkedElderly(null);
      setHasLinkedCaregivers(false);
    }
  }, [userProfile]);

  // 3. Xác định mã gia đình động (Active Room Code)
  // - Nếu là Cụ: Mã phòng chính là pairing_code riêng của Cụ!
  // - Nếu là Con cháu: Mã phòng là pairing_code của Cụ đã kết nối (nếu có).
  const activeFamilyCode =
    userProfile?.role === 'elderly'
      ? userProfile.pairing_code || userProfile.id
      : linkedElderly?.pairing_code || null;

  // 4. Lấy dữ liệu điểm danh và Lắng nghe Realtime THEO ĐÚNG MÃ CỦA CỤ
  useEffect(() => {
    if (!activeFamilyCode) {
      setSystemState('Waiting');
      setCheckInTime(null);
      setRealtimeStatus(supabase.realtime.isConnected() ? 'connected' : 'connecting');
      return;
    }

    setRealtimeStatus('connecting');
    setIsLoading(true);
    async function fetchStatus() {
      const today = getTodayDate();
      const { data, error } = await supabase
        .from('checkin_logs')
        .select('*')
        .eq('family_code', activeFamilyCode)
        .eq('log_date', today)
        .maybeSingle();

      if (data && !error) {
        setSystemState(data.status as SystemState);
        if (data.checkin_time) {
          const time = new Date(data.checkin_time).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          setCheckInTime(time);
        } else {
          setCheckInTime(null);
        }
      } else {
        setSystemState('Waiting');
        setCheckInTime(null);
      }
      setIsLoading(false);
    }

    fetchStatus();

    // Tự động kiểm tra lại trạng thái khi mạng phục hồi hoặc người dùng mở lại tab/mở khóa máy
    const handleRevalidate = () => {
      fetchStatus();
    };
    window.addEventListener('online', handleRevalidate);
    window.addEventListener('visibilitychange', handleRevalidate);
    window.addEventListener('focus', handleRevalidate);

    // Lắng nghe Realtime chỉ riêng cho Cụ này
    const channel = supabase
      .channel(`room-${activeFamilyCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checkin_logs',
          filter: `family_code=eq.${activeFamilyCode}`,
        },
        (payload: any) => {
          const newRow = payload.new;
          if (newRow && newRow.log_date === getTodayDate() && newRow.status) {
            setSystemState(newRow.status as SystemState);
            if (newRow.checkin_time) {
              const time = new Date(newRow.checkin_time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              setCheckInTime(time);
            } else {
              setCheckInTime(null);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('online', handleRevalidate);
      window.removeEventListener('visibilitychange', handleRevalidate);
      window.removeEventListener('focus', handleRevalidate);
    };
  }, [activeFamilyCode]);

  // Đếm ngược hồi chiêu nút Ping
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (pingCooldown > 0) {
      interval = setInterval(() => setPingCooldown((prev) => prev - 1), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pingCooldown]);

  // Quản lý còi hú khẩn cấp cho con cháu khi trạng thái là Emergency
  useEffect(() => {
    if (!sirenRef.current) {
      sirenRef.current = new SirenPlayer();
    }
    if (
      systemState === 'Emergency' &&
      !isSirenMuted &&
      userProfile?.role === 'caregiver' &&
      linkedElderly
    ) {
      sirenRef.current.start();
    } else {
      sirenRef.current.stop();
    }
    return () => {
      sirenRef.current?.stop();
    };
  }, [systemState, isSirenMuted, userProfile, linkedElderly]);

  // Phát chuông Ding-Dong và giọng nói khi Cụ nhận được chuông hỏi thăm (Ping)
  useEffect(() => {
    if (systemState === 'Ping_Requested' && userProfile?.role === 'elderly') {
      playChimeSound();
      const timer = setTimeout(() => {
        triggerSensoryFeedback(
          'Con cháu đang hỏi thăm, Cụ hãy chạm vào màn hình để con yên tâm nhé'
        );
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [systemState, userProfile]);

  // Tự động tìm sos_event_id khi hệ thống ở trạng thái Emergency
  useEffect(() => {
    const targetElderlyId = userProfile?.role === 'caregiver' ? linkedElderly?.id : userProfile?.id;
    if (systemState === 'Emergency' && targetElderlyId) {
      supabase
        .from('sos_events')
        .select('id, created_at')
        .eq('elderly_id', targetElderlyId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setActiveSosEventId(data.id);
            if (!sosStartTime) {
              setSosStartTime(new Date(data.created_at).getTime());
            }
          }
        });
    } else if (systemState !== 'Emergency') {
      setActiveSosEventId(null);
      setSosStartTime(null);
      setHasServerAck(false);
    }
  }, [systemState, linkedElderly, userProfile]);

  // Lắng nghe sự kiện Online để tự động gửi bù tín hiệu SOS từ IndexedDB
  useEffect(() => {
    const handleOnline = async () => {
      console.log('[SafeCheck] Mạng Internet phục hồi -> Kích hoạt flushOfflineQueue()');
      const res = await offlineQueueService.flushOfflineQueue();
      if (res.succeeded > 0 && systemState === 'Emergency') {
        setHasServerAck(true);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [systemState]);

  // Cập nhật 'now' để reevaluate trạng thái Cellular Fallback sau 10s
  useEffect(() => {
    if (systemState !== 'Emergency' || hasServerAck) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const handleVis = () => setNow(Date.now());
    window.addEventListener('visibilitychange', handleVis);
    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVis);
    };
  }, [systemState, hasServerAck]);

  const showCellularFallback =
    systemState === 'Emergency' &&
    !hasServerAck &&
    sosStartTime !== null &&
    now - sosStartTime >= 10000;

  // Bộ đếm 10 giây chống bấm nhầm SOS
  useEffect(() => {
    if (sosCountdown !== null && sosCountdown > 0) {
      sosCountdownIntervalRef.current = setTimeout(() => {
        setSosCountdown(sosCountdown - 1);
      }, 1000);
    } else if (sosCountdown === 0) {
      // Hết 10s mà cụ không hủy -> Kích hoạt SOS lên máy chủ và hú còi
      setSystemState('Emergency');
      setSosCountdown(null);
      setIsSirenMuted(false);
      setSosStartTime(Date.now());
      setHasServerAck(false);
      triggerSensoryFeedback('Báo động khẩn cấp đã được gửi tới người thân');

      // 1. Tạo sự kiện SOS Idempotent & Lưu vào IndexedDB dự phòng ngoại tuyến
      if (userProfile?.id && userProfile.role === 'elderly') {
        const elderlyId = userProfile.id;

        supabase.auth.getSession().then(async ({ data: sessionData }) => {
          const token = sessionData?.session?.access_token;
          await offlineQueueService.enqueueOfflineSOS(elderlyId, 'button', token);

          if (!navigator.onLine) {
            console.log('[SafeCheck] Đang ngoại tuyến: Đã lưu SOS vào IndexedDB, đăng ký Background Sync');
            await offlineQueueService.registerBackgroundSync();
          } else {
            console.log('[SafeCheck] Đang trực tuyến: Tiến hành đồng bộ ngay lập tức');
            const syncRes = await offlineQueueService.flushOfflineQueue();
            if (syncRes.succeeded > 0) {
              setHasServerAck(true);
            }
          }
        });
      }

      // 2. Kích hoạt Realtime cập nhật trạng thái phòng
      if (activeFamilyCode) {
        supabase.rpc('trigger_sos', { p_family_code: activeFamilyCode }).then(({ error }) => {
          if (error) console.error('Lỗi gọi trigger_sos:', error);
        });
      }
    }
    return () => {
      if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    };
  }, [sosCountdown, activeFamilyCode, userProfile]);

  // Flow 1 & Flow 4: Điểm danh
  const handleCheckIn = async () => {
    if (!activeFamilyCode) {
      console.warn('handleCheckIn: Chưa có activeFamilyCode');
      return;
    }
    console.log('[SafeCheck] Đang gọi perform_checkin với family_code:', activeFamilyCode);
    const { data, error } = await supabase.rpc('perform_checkin', {
      p_family_code: activeFamilyCode,
    });

    if (error || !data?.success) {
      console.error('[SafeCheck] Lỗi perform_checkin:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        data,
      });
      const errMsg = error 
        ? `[Mã lỗi ${error.code || 'RPC'}]: ${error.message}` 
        : (data?.message || 'Không thể điểm danh!');
      alert(`Lỗi điểm danh: ${errMsg}`);
      return;
    }
    console.log('[SafeCheck] Điểm danh thành công:', data);
    triggerSensoryFeedback('Điểm danh thành công, con cháu đã nhận được tin');
  };

  // Bắt đầu đè chuột giữ nút SOS (3 giây)
  const startSosHold = () => {
    if (sosCountdown !== null) return;
    setSosHolding(true);
    sosHoldTimerRef.current = setTimeout(() => {
      setSosHolding(false);
      setSosCountdown(10); // Đếm ngược 10 giây chống bấm nhầm
      triggerSensoryFeedback(
        'Đang chuẩn bị gửi báo động. Bạn có 10 giây để bấm hủy nếu chạm nhầm'
      );
    }, 3000);
  };

  const cancelSosHold = () => {
    setSosHolding(false);
    if (sosHoldTimerRef.current) clearTimeout(sosHoldTimerRef.current);
  };

  const abortSosCountdown = () => {
    setSosCountdown(null);
    if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    triggerSensoryFeedback('Đã hủy báo động');
  };

  // Flow 4: Con cháu gửi Ping (Atomic Row Lock)
  const isPingAllowed = ['Waiting', 'Late', 'Safe'].includes(systemState);

  const handleSendPing = async () => {
    const targetElderlyId = linkedElderly?.id;
    if (!isPingAllowed || pingCooldown > 0 || !targetElderlyId) return;

    const { data, error } = await supabase.rpc('request_ping_atomic', {
      p_elderly_id: targetElderlyId,
    });

    if (error) {
      console.error('[SafeCheck] Lỗi request_ping_atomic:', error);
      alert(error.message || 'Không thể gửi chuông');
      return;
    }

    if (data?.error === 'CONFLICT_PING_ALREADY_SENT') {
      console.log('[SafeCheck] Xung đột Ping:', data);
      setConflictToast(data.message || 'Chuông vừa được gửi bởi thành viên khác.');
      if (data.remaining_seconds) {
        setPingCooldown(data.remaining_seconds);
      }
      setTimeout(() => setConflictToast(null), 8000);
      return;
    }

    if (!data?.success) {
      alert(data?.message || 'Không thể gửi chuông');
      return;
    }

    const isTester = userProfile?.email?.toLowerCase() === 'test01@gmail.com';
    setPingCooldown(isTester ? 10 : 15 * 60);
    triggerSensoryFeedback('Đã phát chuông kiểm tra tới máy Cụ');
  };

  // Flow 5: Giải quyết / Tắt báo động (Atomic Resolve)
  const handleResolveAlarm = async () => {
    const targetElderlyId = userProfile?.role === 'caregiver' ? linkedElderly?.id : userProfile?.id;
    if (!targetElderlyId) return;

    let sosIdToResolve = activeSosEventId;
    if (!sosIdToResolve) {
      const { data: latestEvent } = await supabase
        .from('sos_events')
        .select('id')
        .eq('elderly_id', targetElderlyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      sosIdToResolve = latestEvent?.id || null;
    }

    if (!sosIdToResolve) {
      console.warn('[SafeCheck] Không có active sos_event_id để resolve');
      setSystemState('Safe');
      setIsSirenMuted(false);
      return;
    }

    const { data, error } = await supabase.rpc('resolve_alarm_atomic', {
      p_elderly_id: targetElderlyId,
      p_sos_event_id: sosIdToResolve,
      p_note: userProfile?.role === 'caregiver' ? 'Xác nhận an toàn từ Con cháu' : 'Cụ xác nhận an toàn tại chỗ',
    });

    if (error) {
      console.error('[SafeCheck] Lỗi resolve_alarm_atomic:', error);
      setSystemState('Safe');
      setIsSirenMuted(false);
      return;
    }

    if (data?.error === 'CONFLICT_ALREADY_RESOLVED') {
      console.log('[SafeCheck] Xung đột: Báo động đã được giải quyết:', data);
      setConflictToast(data.message || 'Báo động này đã được xử lý bởi thành viên khác.');
      setSystemState('Safe');
      setIsSirenMuted(false);
      setActiveSosEventId(null);
      setTimeout(() => setConflictToast(null), 8000);
      return;
    }

    // Resolve thành công
    setSystemState('Safe');
    setIsSirenMuted(false);
    setActiveSosEventId(null);
    triggerSensoryFeedback('Đã tắt báo động, xác nhận an toàn');
  };

  // Dev Tool: Cập nhật trực tiếp trạng thái hôm nay
  const setManualStatus = async (status: SystemState) => {
    if (!activeFamilyCode) return;
    await supabase
      .from('checkin_logs')
      .update({ status })
      .eq('family_code', activeFamilyCode)
      .eq('log_date', getTodayDate());

    // NẾU TESTER BẤM SET SOS: Kích hoạt tạo sự kiện và phát Web Push thực tế
    if (status === 'Emergency') {
      const targetElderlyId = userProfile?.role === 'elderly' ? userProfile.id : linkedElderly?.id;
      if (targetElderlyId) {
        setSosStartTime(Date.now());
        setHasServerAck(false);
        const clientEventId = crypto.randomUUID();
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_sos_event_idempotent', {
          p_elderly_id: targetElderlyId,
          p_client_event_id: clientEventId,
          p_trigger_source: 'button',
        });

        const sosId = rpcRes?.sos_event_id;
        if (sosId) {
          setActiveSosEventId(sosId);
          setHasServerAck(true);
          await pushNotificationService.sendEmergencyPush(sosId);
        } else if (rpcErr) {
          console.warn('[SafeCheck DevTool] Lỗi create_sos_event_idempotent:', rpcErr);
        }
      }
    } else {
      setActiveSosEventId(null);
      setSosStartTime(null);
      setHasServerAck(false);
    }
  };

  // Ghép nối gia đình (Con cháu gọi RPC connect_family)
  const handleConnectFamily = async (pairingCode: string, relationship: string) => {
    const { data, error } = await supabase.rpc('connect_family', {
      p_pairing_code: pairingCode,
      p_relationship: relationship,
    });

    if (error) {
      return { success: false, message: error.message || 'Lỗi kết nối máy chủ' };
    }
    if (!data?.success) {
      return { success: false, message: data?.message || 'Kết nối thất bại' };
    }

    // Refresh lại liên kết sau khi ghép nối thành công
    if (userProfile) {
      await fetchLinkedElderly(userProfile.id);
    }

    return { success: true, message: data.message };
  };

  // Đăng xuất
  const handleSignOut = async () => {
    await authService.signOut();
    setUserProfile(null);
    setLinkedElderly(null);
  };

  // 1. Màn hình chờ khi đang kiểm tra phiên đăng nhập
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-16 h-16 bg-emerald-600 rounded-3xl flex items-center justify-center animate-bounce mb-3 shadow-lg shadow-emerald-900/50">
          <span className="text-3xl">🛡️</span>
        </div>
        <p className="text-slate-400 text-sm animate-pulse">Đang kiểm tra bảo mật SafeCheck...</p>
      </div>
    );
  }

  // 2. Chưa đăng nhập -> Hiển thị AuthScreen (Mobile Form)
  if (!userProfile) {
    return <AuthScreen onAuthSuccess={(profile) => setUserProfile(profile)} />;
  }

  // 3. Đang tải dữ liệu điểm danh ban đầu
  if (isLoading && activeFamilyCode) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-sans">
        <p className="text-slate-400 animate-pulse">Đang đồng bộ dữ liệu hôm nay...</p>
      </div>
    );
  }

  // Suy luận sức khỏe kết nối (Derived connectionHealth)
  const connectionHealth = deriveConnectionHealth(networkStatus, realtimeStatus);

  // 4. ĐÃ ĐĂNG NHẬP: Điều hướng phân quyền Role (Role-based Navigation)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-0 sm:p-4 flex flex-col items-center justify-center font-sans">
      {/* NẾU LÀ NGƯỜI LỚN TUỔI: Chỉ hiển thị duy nhất màn hình Cụ */}
      {userProfile.role === 'elderly' && (
        <ElderlyScreen
          systemState={systemState}
          checkInTime={checkInTime}
          batteryLevel={batteryLevel}
          isCharging={isCharging}
          sosHolding={sosHolding}
          sosCountdown={sosCountdown}
          elderlyName={userProfile.full_name}
          pairingCode={userProfile.pairing_code}
          hasLinkedCaregivers={hasLinkedCaregivers}
          showCellularFallback={showCellularFallback}
          primaryCaregiverName={primaryCaregiver?.name}
          primaryCaregiverPhone={primaryCaregiver?.phone}
          onCheckIn={handleCheckIn}
          onStartSosHold={startSosHold}
          onCancelSosHold={cancelSosHold}
          onAbortSosCountdown={abortSosCountdown}
          onResolveAlarm={handleResolveAlarm}
        />
      )}

      {/* NẾU LÀ CON CHÁU: Chỉ hiển thị màn hình Dashboard theo dõi */}
      {userProfile.role === 'caregiver' && (
        <CaregiverScreen
          systemState={systemState}
          checkInTime={checkInTime}
          batteryLevel={batteryLevel}
          isCharging={isCharging}
          connectionHealth={connectionHealth}
          pingCooldown={pingCooldown}
          isPingAllowed={isPingAllowed}
          isSirenMuted={isSirenMuted}
          caregiverName={userProfile.full_name}
          linkedElderly={linkedElderly}
          isTester={userProfile.email?.toLowerCase() === 'test01@gmail.com'}
          conflictToast={conflictToast}
          onSendPing={handleSendPing}
          onResolveAlarm={handleResolveAlarm}
          onToggleMuteSiren={() => setIsSirenMuted(!isSirenMuted)}
          onManualStatus={setManualStatus}
          onSignOut={handleSignOut}
          onConnectFamily={handleConnectFamily}
        />
      )}
    </div>
  );
}