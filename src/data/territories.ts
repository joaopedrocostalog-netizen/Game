export type ControlLevel = 'direct' | 'nominal' | 'disputed' | 'influence';

export type OwnershipPeriod = {
  fromYear: number;
  toYear?: number;
  ownerId: string;
  controllerId?: string;
  control: ControlLevel;
  confidence: 'high' | 'medium' | 'estimated';
};

export type WorldLocation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'capital' | 'city' | 'region' | 'port';
  terrain: 'plains' | 'hills' | 'mountains' | 'coastal' | 'forest' | 'desert' | 'mixed';
  ownership: OwnershipPeriod[];
};

export type ResolvedLocation = WorldLocation & {
  ownerId: string | null;
  controllerId: string | null;
  control: ControlLevel | null;
  confidence: OwnershipPeriod['confidence'] | null;
};

export const worldLocations: WorldLocation[] = [
  {
    id: 'loc-lisbon', name: 'Lisboa', lat: 38.7223, lon: -9.1393, kind: 'capital', terrain: 'coastal',
    ownership: [
      { fromYear: 1147, toYear: 1910, ownerId: 'portugal-1500', control: 'direct', confidence: 'high' },
      { fromYear: 1910, ownerId: 'portugal-2026', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-madrid', name: 'Castela Central', lat: 40.4168, lon: -3.7038, kind: 'region', terrain: 'plains',
    ownership: [
      { fromYear: 1230, toYear: 1516, ownerId: 'castile-1500', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-istanbul', name: 'Constantinopla', lat: 41.0082, lon: 28.9784, kind: 'capital', terrain: 'coastal',
    ownership: [
      { fromYear: 1453, toYear: 1922, ownerId: 'ottoman-1500', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-beijing', name: 'Pequim', lat: 39.9042, lon: 116.4074, kind: 'capital', terrain: 'plains',
    ownership: [
      { fromYear: 1421, toYear: 1644, ownerId: 'ming-1500', control: 'direct', confidence: 'high' },
      { fromYear: 1949, ownerId: 'china-2026', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-venice', name: 'Veneza', lat: 45.4408, lon: 12.3155, kind: 'capital', terrain: 'coastal',
    ownership: [
      { fromYear: 697, toYear: 1797, ownerId: 'venice-1500', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-brasilia', name: 'Brasília', lat: -15.7939, lon: -47.8828, kind: 'capital', terrain: 'plains',
    ownership: [
      { fromYear: 1960, ownerId: 'brazil', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-washington', name: 'Washington, D.C.', lat: 38.9072, lon: -77.0369, kind: 'capital', terrain: 'coastal',
    ownership: [
      { fromYear: 1800, ownerId: 'usa-2026', control: 'direct', confidence: 'high' },
    ],
  },
  {
    id: 'loc-tokyo', name: 'Tóquio', lat: 35.6762, lon: 139.6503, kind: 'capital', terrain: 'coastal',
    ownership: [
      { fromYear: 1868, ownerId: 'japan-2026', control: 'direct', confidence: 'high' },
    ],
  },
];

export function resolveLocation(location: WorldLocation, year: number): ResolvedLocation {
  const period = location.ownership
    .filter((item) => item.fromYear <= year && (item.toYear === undefined || item.toYear >= year))
    .sort((a, b) => b.fromYear - a.fromYear)[0];

  return {
    ...location,
    ownerId: period?.ownerId ?? null,
    controllerId: period?.controllerId ?? period?.ownerId ?? null,
    control: period?.control ?? null,
    confidence: period?.confidence ?? null,
  };
}

export function locationsForYear(year: number) {
  return worldLocations.map((location) => resolveLocation(location, year)).filter((location) => location.ownerId);
}

export function locationsForEntity(entityId: string, year: number) {
  return locationsForYear(year).filter((location) => location.ownerId === entityId || location.controllerId === entityId);
}
