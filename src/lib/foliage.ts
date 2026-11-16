import type { Material } from 'three'

/** Select one baked view per tree instance, including when rendered by the shadow camera. */
export function applyFoliageSelection(material: Material): void {
  material.customProgramCacheKey = () => 'baked-leaf-cluster-selection-v2'
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafVisible;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 leafModel = modelMatrix;
        #ifdef USE_INSTANCING
          leafModel = leafModel * instanceMatrix;
        #endif
        // One view per tree instance keeps each card uniformly visible. The mesh
        // origin is its quantized canopy center; no quad can straddle a view boundary.
        vec3 leafEye = normalize((inverse(leafModel) * vec4(cameraPosition, 1.0)).xyz);
        float leafBest = max(max(abs(leafEye.x), abs(leafEye.y)), abs(leafEye.z));
        leafBest = max(leafBest, max(abs(leafEye.x + leafEye.z), abs(leafEye.x - leafEye.z)) * 0.70710678);
        vLeafVisible = abs(dot(normalize(normal), leafEye)) >= leafBest - 0.001 ? 1.0 : 0.0;
        // Reject unused views before rasterization, including shadow passes.
        if (vLeafVisible < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      `)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafVisible;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vLeafVisible < 0.5) discard;')
  }
}
