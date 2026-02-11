const RADIUS = 30;
const CENTER = { x: 0, y: 66, z: 0 };

function islandPos(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(CENTER.x + RADIUS * Math.cos(rad)),
    y: CENTER.y,
    z: Math.round(CENTER.z + RADIUS * Math.sin(rad)),
  };
}

const islands = {
  center: CENTER,
  island_A: islandPos(0),
  island_B: islandPos(45),
  island_C: islandPos(90),
  island_D: islandPos(135),
  island_E: islandPos(180),
  island_F: islandPos(225),
  island_G: islandPos(270),
  island_H: islandPos(315),
};

const spawnIslands = ['island_A', 'island_B', 'island_C', 'island_D', 'island_E', 'island_F', 'island_G', 'island_H'];

export default { islands, spawnIslands, center: CENTER };
