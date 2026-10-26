import { PORTAL } from '@shared/world'

/** Height of the portal ring's centre. */
export const PORTAL_CENTER_Y = PORTAL.radius + 0.6

/** The portal's frame: an icy ring of blocks standing upright, facing the plaza. */
export function buildPortalFrame(blocks) {
  const segments = 20
  const r = PORTAL.radius
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2
    const x = PORTAL.x + Math.cos(a) * r
    const y = PORTAL_CENTER_Y + Math.sin(a) * r
    blocks.add(x, y, PORTAL.z, 1.2, 1.2, 1.4, i % 2 ? '#bfeaff' : '#7fd0ff', 0, 0, 0, a)
  }
  blocks.addOn(PORTAL.x, 0, PORTAL.z, r * 2 + 1.5, 0.5, 2.4, '#e6f6ff')
}
