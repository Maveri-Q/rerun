// Writes the practice files for the demo claims. Every row is invented from a fixed seed. None of it is real.
import { writeFileSync } from "node:fs";

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = mulberry32(20261106);
const spread = (mid, by) => Math.round(mid + (r() - 0.5) * 2 * by);
const save = (file, header, rows) => writeFileSync(new URL(`./${file}`, import.meta.url), `${[header, ...rows].join("\n")}\n`);
const each = (n, row) => Array.from({ length: n }, (_, i) => row(i));

save("ice_cream.csv", "day,weather,cups_sold", each(200, (i) => {
  const sunny = r() < 0.5;
  return `${i + 1},${sunny ? "sunny" : "cloudy"},${spread(sunny ? 120 : 100, 25)}`;
}));
save("dog_walks.csv", "person,has_dog,steps", each(200, (i) => {
  const dog = r() < 0.5;
  return `${i + 1},${dog ? "yes" : "no"},${spread(dog ? 7700 : 6000, 1500)}`;
}));
save("pizza.csv", "order,time_of_day,minutes", each(200, (i) => {
  const night = r() < 0.5;
  return `${i + 1},${night ? "night" : "day"},${spread(night ? 25 : 35, 8)}`;
}));
save("coffee.csv", "day,monday,orders", each(200, (i) => {
  const monday = i % 7 === 0;
  return `${i + 1},${monday ? "yes" : "no"},${spread(monday ? 230 : 200, 30)}`;
}));
