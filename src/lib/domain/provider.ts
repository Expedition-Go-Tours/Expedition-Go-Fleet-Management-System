/* Service provider (garage/vendor) domain model. Simple CRUD — no lifecycle. */

export interface Provider {
  id: string;
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  /** Free-form service tags, e.g. ["mechanical", "tyres", "welding"]. */
  specialties: string[];
  /** Inactive providers are hidden from pickers but retained for history. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
