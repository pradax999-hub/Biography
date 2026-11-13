/**
 * Can this browser run the engine at all? Checked without three.js, so that
 * browsers without WebGL never download the engine.
 */
export function webglSupport(): { ok: boolean; reason?: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, reason: 'no-webgl2' };
    const ok = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok ? { ok: true } : { ok: false, reason: 'no-float-targets' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
