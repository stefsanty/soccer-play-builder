// Full pitch view: 0..68m wide, 0..105m tall
// SVG viewBox: 0 0 680 1050 (10px per meter)
// Half-pitch right side (as in reference): x=16..68, y=0..105 → viewBox 580 890

export const PITCH_W = 68   // meters
export const PITCH_H = 105  // meters
export const PX_PER_M = 10

// Full pitch coordinate to SVG pixel
export const mToSvg = (x: number, y: number) => ({
  svgX: x * PX_PER_M,
  svgY: (PITCH_H - y) * PX_PER_M,  // y=0 is own goal, y=105 is opponent goal (top of SVG)
})

// Half-pitch right side (reference style): x=16..68 → svgX=20..540, y=22..105 → svgY=40..870
export const X = (x: number) => (x - 16) * 10 + 20
export const Y = (y: number) => (105 - y) * 10 + 40

export const svgToM = (svgX: number, svgY: number) => ({
  x: (svgX - 20) / 10 + 16,
  y: 105 - (svgY - 40) / 10,
})
