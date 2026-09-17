export type SystemState =
  | 'Early_Waiting'
  | 'Waiting'
  | 'Safe'
  | 'Late'
  | 'Emergency'
  | 'Ping_Requested'
  | 'Overdue_Ping';

export type UserRole = 'elderly' | 'caregiver';

export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  phone: string | null;
  pairing_code: string | null;
  created_at?: string;
  updated_at?: string;
}

export type EmergencyContactCategory = 'neighbor' | 'relative' | 'authority' | 'medical' | 'other';

export interface EmergencyContact {
  id: string;
  elderly_id: string;
  name: string;
  phone: string;
  contact_type: EmergencyContactCategory;
  note?: string | null;
  priority_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface AlarmLog {
  id: string;
  elderly_id: string;
  sos_event_id?: string | null;
  action: 'SOS_TRIGGERED' | 'RESOLVE' | 'PING' | 'CHECKIN_SAFE';
  performed_by: string;
  performer_name: string;
  performer_role: string;
  note?: string | null;
  previous_state?: string | null;
  new_state?: string | null;
  created_at: string;
}

export interface OfflineSOSEvent {
  client_event_id: string;
  elderly_id: string;
  trigger_source: 'button' | 'timeout';
  created_at: number;
  // Auth credential lưu kèm để Service Worker có thể thực thi ngầm
  access_token?: string;
  // Database sync phase
  db_status: 'PENDING' | 'SYNCING' | 'SERVER_ACKED' | 'FAILED_PERMANENTLY';
  server_ack_at?: number;
  sos_event_id?: string;
  // Push dispatch phase
  push_status: 'NOT_REQUESTED' | 'DISPATCH_PENDING' | 'DISPATCHED' | 'FAILED';
  push_attempt_count: number;
  last_attempt_at?: number;
  error_message?: string;
}

export interface ResolveAlarmResult {
  success: boolean;
  message: string;
  error?: string;
  sos_event_id?: string;
  resolved_by?: string;
  resolved_by_name?: string;
  resolved_at?: string;
}

export interface RequestPingResult {
  success: boolean;
  message: string;
  error?: string;
  last_pinger_name?: string;
  remaining_seconds?: number;
}

export interface CreateSosEventResult {
  success: boolean;
  sos_event_id?: string;
  status?: string;
  is_duplicate?: boolean;
  message?: string;
  error?: string;
}

export interface CheckinSchedule {
  elderly_id: string;
  checkin_start: string; // 'HH:mm:ss'
  checkin_deadline: string; // 'HH:mm:ss'
  emergency_buffer_minutes: number;
  timezone: string;
  is_active: boolean;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateScheduleResult {
  success: boolean;
  message: string;
  error?: string;
  schedule?: {
    checkin_start: string;
    checkin_deadline: string;
    emergency_buffer_minutes: number;
  };
}

export interface PerformCheckinResult {
  success: boolean;
  message: string;
  error?: string;
  checkin_time?: string;
}

