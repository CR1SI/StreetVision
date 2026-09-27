import { PALETTE } from './colors'
import { TYPE_BY_KEY } from './projectTypes'

// Map icons are drawn on a canvas the first time the map asks for them, one per
// (shape, color) pair: "sv:<type>:<#hex>" for project badges, "sv:sub:<#hex>" for substations.
// Drawing on demand means a utility added by an upload gets correctly colored icons too.

const RATIO = 2 // draw at 2x so icons stay crisp on retina screens

function canvas(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size * RATIO
  const ctx = c.getContext('2d')
  ctx.scale(RATIO, RATIO)
  return [c, ctx]
}

function strokeIcon(ctx, paths, x, y, size, color, width = 2.4) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of paths) ctx.stroke(new Path2D(d))
  ctx.restore()
}

/** Round badge in the utility color with the project-type glyph in white. */
function typeBadge(type, color) {
  const size = 30
  const [c, ctx] = canvas(size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = PALETTE.bg
  ctx.stroke()
  strokeIcon(ctx, (TYPE_BY_KEY[type] ?? TYPE_BY_KEY.other).paths, 7, 7, 16, '#FFFFFF')
  return c
}

/** Substation: dark rounded square, utility-colored border, small lightning bolt. */
function substation(color) {
  const size = 20
  const [c, ctx] = canvas(size)
  ctx.beginPath()
  ctx.roundRect(2, 2, size - 4, size - 4, 3.5)
  ctx.fillStyle = PALETTE.bg
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.stroke()
  strokeIcon(ctx, TYPE_BY_KEY.substation.paths, 4.5, 4.5, 11, color, 2.6)
  return c
}

function draw(id) {
  const [, kind, color] = id.split(':')
  if (!kind || !/^#[0-9a-f]{3,8}$/i.test(color ?? '')) return null
  return kind === 'sub' ? substation(color) : typeBadge(kind, color)
}

/** Register the on-demand icon handler once per map. */
export function ensureIcons(map) {
  if (map.__svIcons) return
  map.__svIcons = true
  map.on('styleimagemissing', (e) => {
    if (!e.id.startsWith('sv:') || map.hasImage(e.id)) return
    const c = draw(e.id)
    if (!c) return
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    map.addImage(e.id, { width: c.width, height: c.height, data: data.data }, { pixelRatio: RATIO })
  })
}
