export function applyOrganizationComplianceShock(organizationId: string, cohesionDelta: number, legitimacyDelta: number) {
  const root = globalThis as typeof globalThis & {
    __WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__?: {
      lastProcessedYear?: number;
      organizations: Array<{
        id: string;
        cohesion: number;
        legitimacy: number;
        active: boolean;
        [key: string]: unknown;
      }>;
      proposals: unknown[];
    };
  };
  const state = root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__;
  if (!state) return;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const organizations = state.organizations.map((organization) => organization.id !== organizationId ? organization : {
    ...organization,
    cohesion: clamp(organization.cohesion + cohesionDelta),
    legitimacy: clamp(organization.legitimacy + legitimacyDelta),
    active: organization.active && clamp(organization.cohesion + cohesionDelta) >= 10,
  });
  root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__ = { ...state, organizations };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-diplomatic-organizations', { detail: root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__ }));
}
