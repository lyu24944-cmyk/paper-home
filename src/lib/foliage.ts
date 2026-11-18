import { Material } from 'three'

const SELECTION_KEY = 'baked-leaf-cluster-selection-v3'
const appliedMaterials = new WeakSet<Material>()

/** Select one baked view per tree instance, including when rendered by the shadow camera. */
export function applyFoliageSelection(material: Material): void {
  if (appliedMaterials.has(material)) return
  appliedMaterials.add(material)

  const prevCacheKey = material.customProgramCacheKey
  const hasCustomCacheKey = prevCacheKey !== Material.prototype.customProgramCacheKey
  const prevOnBeforeCompile = material.onBeforeCompile
  const hasCustomOnBeforeCompile = prevOnBeforeCompile !== Material.prototype.onBeforeCompile

  material.customProgramCacheKey = () => {
    const base = hasCustomCacheKey
      ? prevCacheKey.call(material)
      : hasCustomOnBeforeCompile
        ? prevOnBeforeCompile.toString()
        : ''
    return base ? `${base}|${SELECTION_KEY}` : SELECTION_KEY
  }

  material.onBeforeCompile = (shader, renderer) => {
    if (hasCustomOnBeforeCompile) {
      prevOnBeforeCompile.call(material, shader, renderer)
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        mat4 leafModel = modelMatrix;
        #ifdef USE_INSTANCING
          leafModel = leafModel * instanceMatrix;
        #endif
        // One view per tree instance keeps each card uniformly visible. The mesh
        // origin is its quantized canopy center; no quad can straddle a view boundary.
        vec3 leafDelta = cameraPosition - leafModel[3].xyz;
        vec3 leafCol0 = leafModel[0].xyz;
        vec3 leafCol1 = leafModel[1].xyz;
        vec3 leafCol2 = leafModel[2].xyz;
        vec3 leafEye = normalize(vec3(
          dot(leafCol0, leafDelta) / max(1e-6, dot(leafCol0, leafCol0)),
          dot(leafCol1, leafDelta) / max(1e-6, dot(leafCol1, leafCol1)),
          dot(leafCol2, leafDelta) / max(1e-6, dot(leafCol2, leafCol2))
        ));
        float leafBest = max(max(abs(leafEye.x), abs(leafEye.y)), abs(leafEye.z));
        leafBest = max(leafBest, max(abs(leafEye.x + leafEye.z), abs(leafEye.x - leafEye.z)) * 0.70710678);
        float leafVisible = abs(dot(normalize(normal), leafEye)) >= leafBest - 0.001 ? 1.0 : 0.0;
        // Reject unused views before rasterization, including shadow passes.
        if (leafVisible < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      `,
    )
  }
}
