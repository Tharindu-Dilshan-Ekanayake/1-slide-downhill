import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, DoubleSide, ShaderMaterial } from 'three'

import { PORTAL } from '@shared/world'

import { PORTAL_CENTER_Y } from './portalFrame'

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    // A spiral that winds inwards over time.
    float swirl = sin(a * 3.0 + r * 9.0 - uTime * 3.0);
    vec3 deep = vec3(0.12, 0.45, 0.95);
    vec3 ice = vec3(0.75, 0.95, 1.0);
    vec3 col = mix(deep, ice, smoothstep(-0.2, 0.9, swirl) * (1.0 - r * 0.6));
    col += (1.0 - smoothstep(0.0, 0.35, r)) * 0.6;
    float edge = 1.0 - smoothstep(0.92, 1.0, r);
    gl_FragColor = vec4(col, edge * 0.92);
    #include <colorspace_fragment>
  }
`

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Swirl radius; the frame around it is part of the static blocks (see portalFrame.js). */
const RADIUS = PORTAL.radius - 0.4

/** The World 2 portal's animated ice swirl: one quad, one cheap shader. */
export function Portal() {
  const ref = useRef(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      }),
    [],
  )
  const geometry = useMemo(() => new CircleGeometry(RADIUS, 40), [])

  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )

  useFrame((state) => {
    if (ref.current) ref.current.material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <mesh ref={ref} geometry={geometry} material={material} position={[PORTAL.x, PORTAL_CENTER_Y, PORTAL.z]} />
}

export default Portal
