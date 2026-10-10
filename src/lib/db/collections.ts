/** Canonical Firestore collection names. Import these instead of string literals. */
export const COLLECTIONS = {
  users: "users",
  roles: "roles",
  userRoles: "userRoles",
  sessions: "sessions",
  invites: "invites",
  vehicles: "vehicles",
  registrationLocks: "registrationLocks",
  odometerReadings: "odometerReadings",
  mileageEntries: "mileageEntries", // deprecated alias kept for migration
  maintenanceTemplates: "maintenanceTemplates",
  maintenanceSchedules: "maintenanceSchedules",
  serviceRecords: "serviceRecords",
  maintenanceReports: "maintenanceReports", // persisted store for VehicleIssue
  incidentReports: "incidentReports",
  workOrders: "workOrders",
  workOrderIssues: "workOrderIssues",
  assignments: "assignments",
  assignmentReservations: "assignmentReservations",
  inspections: "inspections",
  expenses: "expenses",
  fuelEntries: "fuelEntries",
  vehicleDocuments: "vehicleDocuments",
  notifications: "notifications",
  serviceHistory: "serviceHistory", // deprecated alias kept for migration
  auditLogs: "auditLogs",
  providers: "providers",
  onboarding: "onboarding",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
