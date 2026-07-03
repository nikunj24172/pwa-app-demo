import type { SearchType } from "@/lib/search";

export interface SearchField {
  key: string;
  label: string;
  placeholder: string;
  caps?: boolean;
}

/** A focused search (1–2 fields) with its own button. */
export interface SearchMode {
  label: string; // "Search by owner name"
  button: string; // "Search owner name"
  fields: SearchField[];
}

/** A search service — appears as a row in the session search menu. */
export interface SearchService {
  id: string;
  type: SearchType;
  title: string; // "Current Owner Search"
  breadcrumb: string; // "MVR Search Service · Motukā"
  source: string; // data-source / audit note
  purpose: string; // auto-recorded in the audit trail
  modes: SearchMode[];
}

/** Provider groupings for the menu, per record type. */
export const PROVIDERS: Record<SearchType, { name: string; sub: string; icon: string }> = {
  vehicle: { name: "MVR Search Service", sub: "Motukā", icon: "🚗" },
  company: { name: "NZBN / Company Search", sub: "Kaipakihi", icon: "🏢" },
  property: { name: "Property Search Service", sub: "Whenua", icon: "🏠" },
};

export const SEARCH_SERVICES: SearchService[] = [
  {
    id: "mvr-current-owner",
    type: "vehicle",
    title: "Current Owner Search",
    breadcrumb: "MVR Search Service · Motukā",
    source:
      "Vehicle data is sourced from the Motor Vehicle Register. This query is flagged as a mobile request in the InfoLog audit trail.",
    purpose: "MVR — Current owner search",
    modes: [
      {
        label: "Search by registration plate",
        button: "Search plate",
        fields: [{ key: "registration", label: "Registration plate", placeholder: "e.g. RCF722", caps: true }],
      },
      {
        label: "Search by VIN / chassis",
        button: "Search VIN",
        fields: [{ key: "vin", label: "VIN / chassis", placeholder: "e.g. MPBCMFF60RX653797", caps: true }],
      },
    ],
  },
  {
    id: "nzbn-register",
    type: "company",
    title: "NZBN Register Search",
    breadcrumb: "NZBN Register Search Service",
    source:
      "Company data is sourced live from the New Zealand Companies Office. This query is flagged as a mobile request in the InfoLog audit trail.",
    purpose: "NZBN — Register search",
    modes: [
      {
        label: "Search by name or address",
        button: "Search name / address",
        fields: [
          { key: "name", label: "Entity name", placeholder: "e.g. Fuel Media Limited" },
          { key: "registeredAddress", label: "Entity address", placeholder: "e.g. Halsey Street, Auckland" },
        ],
      },
      {
        label: "Search by number",
        button: "Search number",
        fields: [
          { key: "registrationNumber", label: "NZBN / company number", placeholder: "e.g. 9429041234567" },
        ],
      },
    ],
  },
  {
    id: "nzbn-role",
    type: "company",
    title: "NZBN Role Search",
    breadcrumb: "NZBN / Company Search · Kaipakihi",
    source:
      "Role data is sourced from the New Zealand Companies Office register. This query is flagged as a mobile request in the InfoLog audit trail.",
    purpose: "NZBN — Role search (person)",
    modes: [
      {
        label: "Search a person across the register",
        button: "Search roles",
        fields: [{ key: "director", label: "Person name", placeholder: "e.g. Timothy Clarke" }],
      },
    ],
  },
  {
    id: "property-owner",
    type: "property",
    title: "Owner Name Search",
    breadcrumb: "Property Search Service · Whenua",
    source:
      "Property data is sourced from the District Valuation Roll and Land Information New Zealand. This query is flagged as a mobile request in the InfoLog audit trail.",
    purpose: "Property — Owner name search",
    modes: [
      {
        label: "Search by owner name",
        button: "Search owner name",
        fields: [{ key: "ownerName", label: "Owner name", placeholder: "e.g. Fuel Media Limited" }],
      },
    ],
  },
  {
    id: "property-address",
    type: "property",
    title: "Street Address Search",
    breadcrumb: "Property Search Service · Whenua",
    source:
      "Property data is sourced from the District Valuation Roll and Land Information New Zealand. This query is flagged as a mobile request in the InfoLog audit trail.",
    purpose: "Property — Street address search",
    modes: [
      {
        label: "Search by street address",
        button: "Search address",
        fields: [{ key: "address", label: "Street address", placeholder: "e.g. Kennedy Avenue, Auckland" }],
      },
    ],
  },
];
