/**
 * Camera-facing leaf cards ("billboards"). Every card is a quad whose four
 * vertices store the card centre (`cardCenter`, model space) and the corner
 * offset (`cardCorner`, world units at scale 1). The vertex shader turns the
 * corners towards the camera that renders (also the shadow and impostor
 * cameras), so a crown made of a few dozen cards looks full from every side,
 * from below and from straight above. Works with and without instancing; the
 * model / instance scale must be uniform.
 */

export const BILLBOARD_ATTRIBUTES = /* glsl */ `
attribute vec3 cardCenter;
attribute vec2 cardCorner;
`;

/** Overwrites `transformed` (the model-space position, see three's `begin_vertex`). */
export const BILLBOARD_VERTEX = /* glsl */ `
{
  mat4 cardModel = modelMatrix;
#ifdef USE_INSTANCING
  cardModel = modelMatrix * instanceMatrix;
#endif
  mat3 cardRot = mat3(cardModel);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  transformed = cardCenter + transpose(cardRot) * (camRight * cardCorner.x + camUp * cardCorner.y) / length(cardRot[0]);
}
`;

/** `onBeforeCompile` for built-in materials (standard, basic, depth): billboard the cards. */
export function injectBillboard(shader) {
  shader.vertexShader = BILLBOARD_ATTRIBUTES + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${BILLBOARD_VERTEX}`);
}
