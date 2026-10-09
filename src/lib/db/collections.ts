/** Canonical Firestore collection names. Import these instead of string literals. */
export const COLLECTIONS = {
  users: "users",
  roles: "roles",
  userRoles: "userRoles",
  sessions: "sessions",
  invites: "invites",
  vehicles: "vehicles",
  mileageEntries: "mileageEntries",
  maintenanceReports: "maintenanceReports",
  workOrders: "workOrders",
  expenses: "expenses",
  serviceHistory: "serviceHistory",
  notifications: "notifications",
  auditLogs: "auditLogs",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
