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

const direct = (fromYear: number, ownerId: string, toYear?: number, confidence: OwnershipPeriod['confidence'] = 'high'): OwnershipPeriod => ({
  fromYear, toYear, ownerId, control: 'direct', confidence,
});

export const worldLocations: WorldLocation[] = [
  { id: 'loc-lisbon', name: 'Lisboa', lat: 38.7223, lon: -9.1393, kind: 'capital', terrain: 'coastal', ownership: [direct(1147, 'portugal-1500', 1910), direct(1910, 'portugal-2026')] },
  { id: 'loc-porto', name: 'Porto', lat: 41.1579, lon: -8.6291, kind: 'port', terrain: 'coastal', ownership: [direct(1143, 'portugal-1500', 1910), direct(1910, 'portugal-2026')] },
  { id: 'loc-coimbra', name: 'Coimbra', lat: 40.2033, lon: -8.4103, kind: 'city', terrain: 'hills', ownership: [direct(1143, 'portugal-1500', 1910), direct(1910, 'portugal-2026')] },
  { id: 'loc-faro', name: 'Algarve', lat: 37.0194, lon: -7.9304, kind: 'region', terrain: 'coastal', ownership: [direct(1249, 'portugal-1500', 1910), direct(1910, 'portugal-2026')] },

  { id: 'loc-toledo', name: 'Toledo', lat: 39.8628, lon: -4.0273, kind: 'city', terrain: 'plains', ownership: [direct(1085, 'castile-1500', 1516)] },
  { id: 'loc-seville', name: 'Sevilha', lat: 37.3891, lon: -5.9845, kind: 'city', terrain: 'plains', ownership: [direct(1248, 'castile-1500', 1516)] },
  { id: 'loc-burgos', name: 'Burgos', lat: 42.3439, lon: -3.6969, kind: 'city', terrain: 'plains', ownership: [direct(1035, 'castile-1500', 1516)] },
  { id: 'loc-cadiz', name: 'Costa andaluza', lat: 36.5271, lon: -6.2886, kind: 'port', terrain: 'coastal', ownership: [direct(1262, 'castile-1500', 1516, 'medium')] },

  { id: 'loc-istanbul', name: 'Constantinopla', lat: 41.0082, lon: 28.9784, kind: 'capital', terrain: 'coastal', ownership: [direct(1453, 'ottoman-1500', 1922)] },
  { id: 'loc-edirne', name: 'Edirne', lat: 41.6771, lon: 26.5557, kind: 'city', terrain: 'plains', ownership: [direct(1361, 'ottoman-1500', 1922)] },
  { id: 'loc-bursa', name: 'Bursa', lat: 40.1950, lon: 29.0600, kind: 'city', terrain: 'hills', ownership: [direct(1326, 'ottoman-1500', 1922)] },
  { id: 'loc-thessaloniki', name: 'Salônica', lat: 40.6401, lon: 22.9444, kind: 'port', terrain: 'coastal', ownership: [direct(1430, 'ottoman-1500', 1912)] },
  { id: 'loc-skopje', name: 'Escópia', lat: 41.9981, lon: 21.4254, kind: 'city', terrain: 'mixed', ownership: [direct(1392, 'ottoman-1500', 1912, 'medium')] },

  { id: 'loc-beijing', name: 'Pequim', lat: 39.9042, lon: 116.4074, kind: 'capital', terrain: 'plains', ownership: [direct(1421, 'ming-1500', 1644), direct(1949, 'china-2026')] },
  { id: 'loc-nanjing', name: 'Nanquim', lat: 32.0603, lon: 118.7969, kind: 'city', terrain: 'plains', ownership: [direct(1368, 'ming-1500', 1644), direct(1949, 'china-2026')] },
  { id: 'loc-hangzhou', name: 'Hangzhou', lat: 30.2741, lon: 120.1551, kind: 'city', terrain: 'coastal', ownership: [direct(1368, 'ming-1500', 1644), direct(1949, 'china-2026')] },
  { id: 'loc-guangzhou', name: 'Guangzhou', lat: 23.1291, lon: 113.2644, kind: 'port', terrain: 'coastal', ownership: [direct(1368, 'ming-1500', 1644), direct(1949, 'china-2026')] },

  { id: 'loc-venice', name: 'Veneza', lat: 45.4408, lon: 12.3155, kind: 'capital', terrain: 'coastal', ownership: [direct(697, 'venice-1500', 1797)] },
  { id: 'loc-padua', name: 'Pádua', lat: 45.4064, lon: 11.8768, kind: 'city', terrain: 'plains', ownership: [direct(1405, 'venice-1500', 1797)] },
  { id: 'loc-verona', name: 'Verona', lat: 45.4384, lon: 10.9916, kind: 'city', terrain: 'plains', ownership: [direct(1405, 'venice-1500', 1797)] },
  { id: 'loc-crete', name: 'Cândia / Creta', lat: 35.3387, lon: 25.1442, kind: 'port', terrain: 'coastal', ownership: [direct(1212, 'venice-1500', 1669)] },

  { id: 'loc-brasilia', name: 'Brasília', lat: -15.7939, lon: -47.8828, kind: 'capital', terrain: 'plains', ownership: [direct(1960, 'brazil')] },
  { id: 'loc-saopaulo', name: 'São Paulo', lat: -23.5505, lon: -46.6333, kind: 'city', terrain: 'hills', ownership: [direct(1822, 'brazil')] },
  { id: 'loc-rio', name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, kind: 'port', terrain: 'coastal', ownership: [direct(1822, 'brazil')] },

  { id: 'loc-washington', name: 'Washington, D.C.', lat: 38.9072, lon: -77.0369, kind: 'capital', terrain: 'coastal', ownership: [direct(1800, 'usa-2026')] },
  { id: 'loc-newyork', name: 'Nova York', lat: 40.7128, lon: -74.0060, kind: 'port', terrain: 'coastal', ownership: [direct(1776, 'usa-2026')] },
  { id: 'loc-losangeles', name: 'Los Angeles', lat: 34.0522, lon: -118.2437, kind: 'port', terrain: 'coastal', ownership: [direct(1848, 'usa-2026')] },

  { id: 'loc-tokyo', name: 'Tóquio', lat: 35.6762, lon: 139.6503, kind: 'capital', terrain: 'coastal', ownership: [direct(1868, 'japan-2026')] },
  { id: 'loc-osaka', name: 'Osaka', lat: 34.6937, lon: 135.5023, kind: 'city', terrain: 'coastal', ownership: [direct(1868, 'japan-2026')] },

  { id: 'loc-lisbon-modern', name: 'Área metropolitana de Lisboa', lat: 38.75, lon: -9.20, kind: 'region', terrain: 'coastal', ownership: [direct(1910, 'portugal-2026')] },
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
