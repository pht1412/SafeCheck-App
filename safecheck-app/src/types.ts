export type SystemState =
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

