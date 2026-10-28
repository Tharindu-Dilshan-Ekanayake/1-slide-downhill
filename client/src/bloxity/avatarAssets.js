/**
 * URL construction and slot metadata for Bloxity avatar assets.
 *
 * The shapes here are not guesses: they mirror the assembly logic inside
 * legion-sdk.min.js (the same code that renders the avatar preview in the Bloxity
 * portal), so an avatar built with this file matches what the player sees there.
 *
 * `avatar.getEquipped()` returns:
 *   { hatId, backId, skinId, headId, armLId, armRId, legLId, legRId, torsoId,
 *     hairId, maskId, neckId, chestId, waistId, handId, shoesId,
 *     pantsId, shirtId, faceId }
 */

import { bloxityEnv } from './env'

/** Where avatar assets live in the told environment. */
const cdn = () => `${bloxityEnv().staticUrl}/avatars`

/** The base humanoid body + skeleton. All other assets modify this. */
export const baseBodyUrl = () => `${cdn()}/player.glb`

/** Bone that hats attach to, from player.glb's skeleton. */
export const HAT_BONE = 'Neck1'
/** Bone that back items attach to. */
export const BACK_BONE = 'Spine2'
/** Bone whose bind-pose Y drives the neckHeight proportion. */
export const NECK_OFFSET_BONE = 'Neck_Offset'

/** Skin id used when nothing is equipped — the base body has no baked-in texture. */
export const DEFAULT_SKIN_ID = '0'

/**
 * Body-part slots.
 *
 * Each maps an equipped id onto a named skinned mesh already present in player.glb.
 * A part is applied by swapping that mesh's *geometry*, not by attaching a new
 * object — that is what keeps it bound to the shared skeleton.
 */
export const PART_SLOTS = {
  head: { idKey: 'headId', mesh: 'default_head', dir: 'head', suffix: '' },
  arm_L: { idKey: 'armLId', mesh: 'default_arm_L', dir: 'arms', suffix: '_L' },
  arm_R: { idKey: 'armRId', mesh: 'default_arm_R', dir: 'arms', suffix: '_R' },
  leg_L: { idKey: 'legLId', mesh: 'default_leg_L', dir: 'legs', suffix: '_L' },
  leg_R: { idKey: 'legRId', mesh: 'default_leg_R', dir: 'legs', suffix: '_R' },
  torso: { idKey: 'torsoId', mesh: 'default_torso', dir: 'torso', suffix: '' },
}

/** Values that all mean "nothing equipped". Superset of the SDK's own check. */
const EMPTY_IDS = new Set(['-1', '', 'undefined', 'null'])

/**
 * @param {unknown} id
 * @returns {boolean} true when the id names a real asset worth fetching
 */
export function isRealId(id) {
  if (id === null || id === undefined) return false
  return !EMPTY_IDS.has(String(id).trim())
}

export const assetUrls = {
  part: (slot, id) => {
    const { dir, suffix } = PART_SLOTS[slot]
    return `${cdn()}/parts/${dir}/${id}${suffix}.glb`
  },
  skinTexture: (id) => `${cdn()}/skins/${id}.png`,
  /** Hats, hair and masks all live with the hats. */
  hatMesh: (id) => `${cdn()}/items/hats/${id}.obj`,
  hatTexture: (id) => `${cdn()}/textures/hats/${id}.png`,
  backMesh: (id) => `${cdn()}/items/back/${id}.obj`,
  backTexture: (id) => `${cdn()}/textures/back/${id}.png`,
  /** Neck, chest, waist, hand and shoes items. */
  itemMesh: (slot, id) => `${cdn()}/items/${slot}/${id}.obj`,
  itemTexture: (slot, id) => `${cdn()}/textures/${slot}/${id}.png`,
}

/**
 * The accessory slots beyond hat and back, each on its bone at `origin` (player.glb
 * model space). Hands and shoes are worn as a pair: the item on the left bone plus a
 * copy mirrored across x on the right one.
 */
export const ACCESSORY_SLOTS = {
  neck: { idKey: 'neckId', bone: 'Spine2', origin: [0, 4.8, 0] },
  chest: { idKey: 'chestId', bone: 'Spine2', origin: [0, 3.6, 0] },
  waist: { idKey: 'waistId', bone: 'Spine1', origin: [0, 2.4, 0] },
  hand: { idKey: 'handId', bone: 'ArmL2_leaf', mirrorBone: 'ArmR2_leaf', origin: [0, 0, 0] },
  shoes: { idKey: 'shoesId', bone: 'LegL2_leaf', mirrorBone: 'LegR2_leaf', origin: [0, 0, 0] },
}

/** Skin ids fall back to "0" rather than being skipped. */
export const skinIdOrDefault = (id) => (isRealId(id) ? String(id) : DEFAULT_SKIN_ID)

/**
 * Clothing and face are not separate meshes: Bloxity draws them onto the skin texture
 * server-side. Listed in the order the API expects their URL segments.
 */
const SKIN_OVERLAYS = [
  ['pantsId', 'pn'],
  ['shirtId', 'sh'],
  ['faceId', 'fc'],
]

/**
 * URL of the skin with the worn pants, shirt and face drawn on, or null when none are
 * worn (then the plain `assetUrls.skinTexture` is the right texture).
 *
 * Mirrors the SDK's `avatar.getSkinTextureUrl()`, but built from the equipped payload
 * this component is rendering rather than the SDK's current user, so it can't lag a
 * live outfit change.
 */
export function skinCompositeUrl(equipped) {
  // As in the SDK, '0' also means "no overlay" here.
  const worn = (id) => isRealId(id) && String(id) !== '0'
  const layers = SKIN_OVERLAYS.filter(([key]) => worn(equipped?.[key]))
  if (layers.length === 0) return null

  let key = `s${skinIdOrDefault(equipped.skinId)}`
  for (const [field, prefix] of layers) key += `_${prefix}${equipped[field]}`
  return `${bloxityEnv().apiUrl}/v1/avatar/skin-texture/${key}.png`
}
