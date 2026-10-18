// Meteorological direction is where the wind comes FROM. The rider always
// points up in the illustration; map arrows show where the air moves TO.
export function windRelation(direction, heading, speed) {
  const relative = ((direction - heading) % 360 + 360) % 360;
  if (speed < 1) return { relative, label:'רוח ממוצעת חלשה מאוד', visible:false };
  const r = relative * Math.PI / 180;
  const side = Math.sin(r) > .35 ? 'מימין' : Math.sin(r) < -.35 ? 'משמאל' : '';
  const longitudinal = Math.cos(r) > .35 ? 'מלפנים' : Math.cos(r) < -.35 ? 'מאחור' : '';
  return { relative, label: `הרוח מגיעה ${[side,longitudinal].filter(Boolean).join(' ו')}`, visible:true };
}
