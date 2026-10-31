import { CanvasTexture, Sprite, SpriteMaterial } from 'three'

const FONT_PX = 28
const PADDING_PX = 10
/** Sprite height in world units; the width follows the text's aspect. */
const LABEL_HEIGHT = 0.3

/** A text sprite for an overlay marker. Browser only: it rasterises through a canvas. */
export function createOverlayLabel(text: string, color = '#f8fafc'): Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('overlay label: 2d canvas context unavailable')
  context.font = `${FONT_PX}px sans-serif`
  canvas.width = Math.ceil(context.measureText(text).width) + PADDING_PX * 2
  canvas.height = FONT_PX + PADDING_PX * 2
  context.font = `${FONT_PX}px sans-serif`
  context.fillStyle = 'rgba(15, 23, 42, 0.75)'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.fillText(text, PADDING_PX, canvas.height / 2)
  const texture = new CanvasTexture(canvas)
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.renderOrder = 1001
  sprite.scale.set(LABEL_HEIGHT * canvas.width / canvas.height, LABEL_HEIGHT, 1)
  return sprite
}
