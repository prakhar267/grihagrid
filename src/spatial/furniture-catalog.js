// Shared dimensions are millimetres; geometry, editor and fixtures use one catalog.
export const furnitureSizes = {
  chair: [700, 700, 800], sofa: [2400, 900, 850], bed: [1800, 2200, 650], table: [1400, 800, 750], desk: [1400, 650, 750],
  'coffee-table': [1100, 600, 400], counter: [1800, 600, 900], 'kitchen-counter': [2400, 650, 900], island: [1400, 800, 900],
  stool: [400, 400, 650], wardrobe: [1500, 600, 2200], shelf: [1000, 350, 1800], nightstand: [450, 450, 500], console: [1200, 400, 800],
  rug: [2500, 1800, 18], plant: [450, 450, 1400], tree: [1800, 1800, 3500], lamp: [400, 400, 1800], bathtub: [1700, 750, 580],
  toilet: [550, 700, 750], washbasin: [700, 500, 850], shower: [900, 900, 2100], refrigerator: [700, 700, 1800],
  'washing-machine': [650, 650, 850], 'puja-unit': [1000, 450, 1600],
}
export const furnitureKinds = Object.keys(furnitureSizes)
export const furnitureLabel = kind => kind.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase())
