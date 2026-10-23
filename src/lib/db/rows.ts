export type HouseholdRow = {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  created_at: string;
};

export type MemberRow = {
  id: string;
  household_id: string;
  email: string | null;
  password_hash: string | null;
  name: string;
  color: string;
  avatar: string;
  role: "parent" | "adult" | "teen" | "child" | "relative";
  relationship: string | null;
  birthday: string | null;
  timezone: string;
  locale: string;
  is_admin: number;
  permission_overrides_json: string;
  notification_prefs_json: string;
  dashboard_prefs_json: string;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InvitationRow = {
  id: string;
  household_id: string;
  email: string | null;
  member_id: string | null;
  role: "parent" | "adult" | "teen" | "child" | "relative";
  invited_by: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export type SessionRow = {
  id: string;
  member_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string | null;
};

export type CalendarRow = {
  id: string;
  household_id: string;
  name: string;
  color: string;
  scope: "personal" | "shared";
  owner_member_id: string | null;
  kind: string;
  archived_at: string | null;
  created_at: string;
};

export type CalendarShareRow = {
  calendar_id: string;
  member_id: string;
  access: "view" | "edit";
};

export type EventRow = {
  id: string;
  household_id: string;
  calendar_id: string;
  created_by: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: number;
  timezone: string;
  visibility: "household" | "private";
  status: "confirmed" | "tentative" | "cancelled";
  recurrence_rule: string | null;
  recurrence_exception_dates_json: string;
  reminder_minutes_json: string;
  travel_minutes: number;
  preparation_minutes: number;
  source: string;
  external_uid: string | null;
  created_at: string;
  updated_at: string;
};

export type EventParticipantRow = {
  event_id: string;
  member_id: string;
  response: "invited" | "accepted" | "declined" | "tentative" | "awaiting";
  is_required: number;
};

export type TaskRow = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "done" | "cancelled";
  category: string;
  assigned_member_id: string | null;
  created_by: string;
  recurrence_rule: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReminderRow = {
  id: string;
  household_id: string;
  member_id: string;
  title: string;
  remind_at: string;
  status: "pending" | "sent" | "done" | "cancelled";
  related_type: string | null;
  related_id: string | null;
  created_at: string;
};

export type ShoppingListRow = {
  id: string;
  household_id: string;
  name: string;
  store: string | null;
  created_by: string;
  archived_at: string | null;
  created_at: string;
};

export type ShoppingItemRow = {
  id: string;
  household_id: string;
  list_id: string;
  name: string;
  quantity: string | null;
  brand: string | null;
  category: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  estimated_price: number | null;
  assigned_member_id: string | null;
  status: "open" | "bought" | "removed";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PackageRow = {
  id: string;
  household_id: string;
  description: string;
  merchant: string | null;
  tracking_number: string | null;
  carrier: string | null;
  tracking_url: string | null;
  expected_from: string | null;
  expected_to: string | null;
  status: "expected" | "in_transit" | "out_for_delivery" | "delivered" | "collected" | "missed" | "returned";
  recipient_member_id: string | null;
  collector_member_id: string | null;
  instructions: string | null;
  pickup_point: string | null;
  collection_code: string | null;
  deadline: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CallRow = {
  id: string;
  household_id: string;
  direction: "incoming" | "outgoing" | "missed";
  contact_name: string;
  phone: string | null;
  reason: string | null;
  notes: string | null;
  callback_at: string | null;
  deadline: string | null;
  assigned_member_id: string | null;
  status: "pending" | "completed" | "postponed" | "cancelled";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type NoteRow = {
  id: string;
  household_id: string;
  title: string;
  body: string;
  visibility: "household" | "private" | "restricted";
  owner_member_id: string;
  category: string;
  sensitive: number;
  attachments_json: string;
  created_at: string;
  updated_at: string;
};

export type RecipeRow = {
  id: string;
  household_id: string;
  title: string;
  ingredients_json: string;
  instructions: string | null;
  tags: string | null;
  servings: number;
  created_by: string;
  created_at: string;
};

export type MealPlanRow = {
  id: string;
  household_id: string;
  date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  recipe_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type InventoryRow = {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  min_stock: number | null;
  updated_at: string;
};

export type SchoolDayRow = {
  id: string;
  household_id: string;
  member_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  early_dismissal: number;
  notes: string | null;
  source: string;
};

export type PickupRow = {
  id: string;
  household_id: string;
  member_id: string;
  date: string;
  direction: "dropoff" | "pickup";
  time: string;
  responsible_member_id: string | null;
  status: "unassigned" | "assigned" | "confirmed" | "completed" | "cancelled";
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TripRow = {
  id: string;
  household_id: string;
  title: string;
  destination: string | null;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  budget: number | null;
  status: "planning" | "confirmed" | "completed" | "cancelled";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TripRsvpRow = {
  id: string;
  household_id: string;
  trip_id: string;
  member_id: string | null;
  guest_name: string | null;
  response: "invited" | "accepted" | "declined" | "tentative" | "awaiting";
  responded_at: string | null;
  created_at: string;
};

export type PollRow = {
  id: string;
  household_id: string;
  trip_id: string | null;
  question: string;
  kind: "date" | "destination" | "activity";
  status: "open" | "closed";
  closes_at: string | null;
  created_by: string;
  created_at: string;
};

export type PollOptionRow = {
  id: string;
  poll_id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type NotificationRow = {
  id: string;
  household_id: string;
  member_id: string;
  title: string;
  body: string | null;
  category: string;
  urgency: "low" | "normal" | "high";
  dedupe_key: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type ApprovalRow = {
  id: string;
  household_id: string;
  requested_by: string;
  action: string;
  summary: string;
  payload_json: string;
  risk: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type ToolExecutionRow = {
  id: string;
  household_id: string;
  member_id: string;
  conversation_id: string | null;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  status: "success" | "error" | "pending_approval" | "denied";
  error: string | null;
  approval_id: string | null;
  duration_ms: number | null;
  created_at: string;
};

export type IntegrationRow = {
  id: string;
  household_id: string;
  kind: string;
  status: "disabled" | "configured" | "connected" | "error";
  display_name: string;
  config_json: string;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
};
